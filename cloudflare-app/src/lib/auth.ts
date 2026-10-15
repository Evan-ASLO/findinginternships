import { createRemoteJWKSet, jwtVerify } from "jose";
import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { AuthenticationError, ClientInputError, ConflictError } from "./errors";
import type {
	AppEnvironment,
	AuthenticatedUser,
	CredentialProvider,
} from "../types";
import {
	createSession,
	findSession,
	putCredential,
	revokeSession,
	touchSession,
	upsertUser,
} from "./db";
import {
	decryptCredential,
	encryptCredential,
	openPayload,
	sealPayload,
	secretHint,
} from "./crypto";
import {
	bufferSource,
	randomToken,
	safeEqual,
	sha256,
	toBase64Url,
	utf8,
} from "./encoding";
import {
	hasBetaAccess,
	betaAccessMode,
	isBetaAdmin,
	normalizeBetaEmail,
	requestVerifiedBetaAccess,
} from "./beta";
import { clearPendingSignupCookies, confirmSignup, pendingSignup, signupIdentityAllowed, signupVerificationEnabled, startPendingSignup, supersedePendingSignup } from "./signup-verification";
import { admitVerifiedSignup, assertSignupAccessAllowed, signupAccessBlocked, signupAccessBlockedSql, signupProofOrLegacySql } from "./signup-access";

const SESSION_COOKIE = "cc_session";
const CSRF_COOKIE = "cc_csrf";
const OAUTH_COOKIE = "cc_oauth";
const googleJwks = createRemoteJWKSet(
	new URL("https://www.googleapis.com/oauth2/v3/certs"),
);

type OAuthMode = "login" | "connect" | "request";
interface OAuthState {
	state: string;
	verifier: string;
	nonce: string;
	mode: OAuthMode;
	userId?: string;
	createdAt: number;
	returnTo?: string;
}

export function safeAppReturnPath(origin: string, input?: string): string {
	if (!input) return "/";
	if (input.length > 3000 || !input.startsWith("/") || input.startsWith("//") || /[\u0000-\u001f\u007f]/.test(input)) throw new ClientInputError("Invalid app return destination.");
	const url = new URL(input, origin);
	if (url.origin !== new URL(origin).origin || url.pathname !== "/" || url.username || url.password) throw new ClientInputError("Invalid app return destination.");
	const result = new URL("/", origin);
	for (const key of ["q", "company", "location", "region", "category", "industry", "length", "term", "posted", "page", "pageSize", "selectedJob", "contactJob"]) {
		const value = url.searchParams.get(key);
		if (value !== null) {
			if (value.length > 240) throw new ClientInputError("Invalid app return destination.");
			result.searchParams.set(key, value);
		}
	}
	const hash = url.hash.slice(1);
	if (hash && !["home", "jobs", "find-jobs", "applications", "my-jobs", "networking", "people", "settings", "analytics"].includes(hash)) throw new ClientInputError("Invalid app return destination.");
	result.hash = hash;
	return `${result.pathname}${result.search}${result.hash}`;
}

function secureCookie(c: Parameters<typeof setCookie>[0]): boolean {
	return new URL(c.env.APP_ORIGIN).protocol === "https:";
}

function cookieName(
	c: Parameters<typeof setCookie>[0],
	baseName: string,
): string {
	return secureCookie(c) ? `__Host-${baseName}` : baseName;
}

export async function beginGoogleOAuth(
	c: Parameters<typeof setCookie>[0],
	mode: OAuthMode,
	userId?: string,
): Promise<Response> {
	const state = randomToken();
	const verifier = randomToken(48);
	const nonce = randomToken();
	const challenge = toBase64Url(
		await crypto.subtle.digest("SHA-256", bufferSource(utf8(verifier))),
	);
	const payload: OAuthState = {
		state,
		verifier,
		nonce,
		mode,
		userId,
		createdAt: Date.now(),
		...(mode === "login" ? { returnTo: safeAppReturnPath(c.env.APP_ORIGIN, c.req.query("returnTo")) } : {}),
	};
	setCookie(
		c,
		cookieName(c, OAUTH_COOKIE),
		await sealPayload(c.env, "google-oauth", {
			...payload,
		}),
		{
		httpOnly: true,
		secure: secureCookie(c),
		sameSite: "Lax",
		path: "/",
		maxAge: 600,
		},
	);

	const scopes =
		mode !== "connect"
			? ["openid", "email", "profile"]
			: [
					"openid",
					"email",
					"profile",
					"https://www.googleapis.com/auth/gmail.send",
					"https://www.googleapis.com/auth/gmail.readonly",
					"https://www.googleapis.com/auth/drive.file",
					"https://www.googleapis.com/auth/spreadsheets",
				];
	const parameters = new URLSearchParams({
		client_id: c.env.GOOGLE_CLIENT_ID,
		redirect_uri: `${c.env.APP_ORIGIN}/auth/google/callback`,
		response_type: "code",
		scope: scopes.join(" "),
		state,
		nonce,
		code_challenge: challenge,
		code_challenge_method: "S256",
		include_granted_scopes: "true",
		prompt: mode === "connect" ? "consent" : "select_account",
	});
	if (mode === "connect") parameters.set("access_type", "offline");
	return c.redirect(
		`https://accounts.google.com/o/oauth2/v2/auth?${parameters}`,
		302,
	);
}

export async function handleGoogleCallback(
	c: Context<AppEnvironment>,
): Promise<Response> {
	const sealed = getCookie(c, cookieName(c, OAUTH_COOKIE));
	if (!sealed) throw new Error("OAuth state cookie is missing.");
	deleteCookie(c, cookieName(c, OAUTH_COOKIE), {
		path: "/",
		secure: secureCookie(c),
	});
	const oauth = await openPayload<OAuthState>(
		c.env,
		"google-oauth",
		sealed,
	);
	if (Date.now() - oauth.createdAt > 10 * 60 * 1000) {
		throw new Error("OAuth state expired.");
	}
	const returnedState = c.req.query("state") || "";
	if (!returnedState || !safeEqual(returnedState, oauth.state)) {
		throw new Error("OAuth state validation failed.");
	}
	const code = c.req.query("code");
	if (!code) throw new Error("Google did not return an authorization code.");

	const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
		method: "POST",
		headers: { "Content-Type": "application/x-www-form-urlencoded" },
		body: new URLSearchParams({
			code,
			client_id: c.env.GOOGLE_CLIENT_ID,
			client_secret: c.env.GOOGLE_CLIENT_SECRET,
			redirect_uri: `${c.env.APP_ORIGIN}/auth/google/callback`,
			grant_type: "authorization_code",
			code_verifier: oauth.verifier,
		}),
	});
	if (!tokenResponse.ok) throw new Error("Google token exchange failed.");
	const tokens = (await tokenResponse.json()) as {
		access_token: string;
		refresh_token?: string;
		id_token: string;
		scope: string;
		expires_in: number;
	};
	const { payload } = await jwtVerify(tokens.id_token, googleJwks, {
		audience: c.env.GOOGLE_CLIENT_ID,
		issuer: ["https://accounts.google.com", "accounts.google.com"],
	});
	if (payload.nonce !== oauth.nonce || !payload.sub || !payload.email) {
		throw new Error("Google identity validation failed.");
	}

	const profile = {
		googleSub: payload.sub,
		email: normalizeBetaEmail(String(payload.email)),
		name: String(payload.name || ""),
		image: String(payload.picture || ""),
	};
	if (signupVerificationEnabled(c.env)) {
		await assertSignupAccessAllowed(c.env, profile.googleSub, profile.email);
		const registered = await c.env.DB.prepare("SELECT email FROM users WHERE google_sub=?")
			.bind(profile.googleSub).first<{ email: string }>();
		if (registered && registered.email !== profile.email && payload.email_verified !== true) {
			throw new ClientInputError("Google must verify a changed email address before sign-in.");
		}
		await supersedePendingSignup(c, profile);
	}

	if (oauth.mode === "connect") {
		const session = await authenticatedUser(c);
		if (
			!session ||
			session.googleSub !== profile.googleSub ||
			oauth.userId !== session.id
		) {
			throw new Error("Connected Google account does not match the session.");
		}
		if (!(await signupIdentityAllowed(c.env, profile.googleSub, profile.email))) {
			throw new ClientInputError("Your Google email needs verification. Sign in again before reconnecting Google services.");
		}
		const user = signupVerificationEnabled(c.env)
			? await acceptVerifiedGoogleLogin(c.env, profile) : await upsertUser(c.env, profile);
		if (!user) throw new AuthenticationError();
		if (tokens.refresh_token) {
			const encrypted = await encryptCredential(
				c.env,
				user.id,
				"OAUTH_REFRESH_TOKEN",
				"GOOGLE",
				tokens.refresh_token,
			);
			await putCredential(c.env, {
				userId: user.id,
				kind: "OAUTH_REFRESH_TOKEN",
				provider: "GOOGLE",
				encrypted,
				keyHint: "Google connected",
				metadata: { scope: tokens.scope },
			});
		}
		return c.redirect("/?connected=1", 302);
	}

	if (signupVerificationEnabled(c.env)) {
		const token = getCookie(c, cookieName(c, SESSION_COOKIE));
		if (token) {
			const previous = await findSession(c.env, await sha256(token));
			if (!previous || previous.google_sub !== profile.googleSub || previous.email !== profile.email) clearExistingWorkspaceCookies(c);
		}
	}
	if (!(await signupIdentityAllowed(c.env, profile.googleSub, profile.email))) {
		if (payload.email_verified !== true) {
			throw new ClientInputError("Google must verify your email address before starting email-link signup.");
		}
		clearExistingWorkspaceCookies(c);
		await startPendingSignup(c, { googleSub: profile.googleSub, email: profile.email, emailVerified: true },
			safeAppReturnPath(c.env.APP_ORIGIN, oauth.returnTo));
		return c.redirect("/signup/pending", 302);
	}

	if (oauth.mode === "request" && !signupVerificationEnabled(c.env)) {
		clearPendingSignupCookies(c);
		await requestVerifiedBetaAccess(c.env, {
			email: profile.email,
			googleSub: profile.googleSub,
		});
		return c.redirect("/?access=requested", 302);
	}

	const user = await acceptVerifiedGoogleLogin(c.env, profile);
	clearPendingSignupCookies(c);
	if (!user) return c.redirect("/?access=requested", 302);
	await issueSession(c, user);
	return c.redirect(safeAppReturnPath(c.env.APP_ORIGIN, oauth.returnTo), 302);
}

function clearExistingWorkspaceCookies(c: Parameters<typeof deleteCookie>[0]): void {
	for (const baseName of [SESSION_COOKIE, CSRF_COOKIE]) {
		const name = cookieName(c, baseName);
		if (getCookie(c, name)) deleteCookie(c, name, { path: "/", secure: secureCookie(c) });
	}
}

export async function acceptVerifiedGoogleLogin(
	env: AppEnvironment["Bindings"],
	profile: Omit<AuthenticatedUser, "id">,
): Promise<AuthenticatedUser | null> {
	const normalizedProfile = {
		...profile,
		email: normalizeBetaEmail(profile.email),
	};
	if (!(await signupIdentityAllowed(env, normalizedProfile.googleSub, normalizedProfile.email))) return null;
	if (signupVerificationEnabled(env)) {
		await assertSignupAccessAllowed(env, normalizedProfile.googleSub, normalizedProfile.email);
		if (!(await hasBetaAccess(env, normalizedProfile.email)) &&
			!(await admitVerifiedSignup(env, normalizedProfile.googleSub, normalizedProfile.email))) return null;
	}
	if (await hasBetaAccess(env, normalizedProfile.email)) {
		return upsertUser(env, normalizedProfile);
	}
	await requestVerifiedBetaAccess(env, {
		email: normalizedProfile.email,
		googleSub: normalizedProfile.googleSub,
	});
	return null;
}

export async function confirmSignupAndSignIn(
	c: Context<AppEnvironment>,
	raw: unknown,
) {
	const pending = await pendingSignup(c);
	if (!pending) throw new AuthenticationError();
	const currentToken = getCookie(c, cookieName(c, SESSION_COOKIE));
	if (currentToken) {
		const current = await findSession(c.env, await sha256(currentToken));
		if (current && (current.google_sub !== pending.google_sub || current.email !== pending.email)) {
			throw new ConflictError("The signed-in account changed. Sign out and restart signup with your own Google account.");
		}
	}
	const proof = await confirmSignup(c, raw);
	const previous = await c.env.DB.prepare("SELECT name,image FROM users WHERE google_sub=?").bind(proof.googleSub)
		.first<{ name: string; image: string }>();
	const user = await acceptVerifiedGoogleLogin(c.env, {
		googleSub: proof.googleSub, email: proof.email, name: previous?.name || "", image: previous?.image || "",
	});
	if (!user) throw new AuthenticationError();
	await issueSession(c, user, { id: proof.flowId, receipt: proof.receipt });
	clearPendingSignupCookies(c);
	return { emailVerified: true, fullSessionCreated: true, redirectTo: safeAppReturnPath(c.env.APP_ORIGIN, proof.returnTo) };
}

async function issueSession(
	c: Parameters<typeof setCookie>[0],
	user: AuthenticatedUser,
	signupFlow?: { id: string; receipt: string },
): Promise<void> {
	const sessionToken = randomToken(32);
	const csrfToken = randomToken(32);
	const expires = new Date(
		Date.now() + Number(c.env.SESSION_DAYS || 30) * 24 * 60 * 60 * 1000,
	);
	if (signupVerificationEnabled(c.env)) {
		const now = new Date().toISOString();
		// Account switches can revoke a confirmation session even if its response arrives late.
		const sessionId = signupFlow?.receipt || crypto.randomUUID();
		const created = await c.env.DB.prepare(`WITH identity AS (
			SELECT google_sub,email,? AS owner_override FROM users WHERE id=? AND google_sub=? AND email=? AND deleted_at IS NULL)
			INSERT INTO sessions(id,user_id,token_hash,csrf_hash,expires_at,last_seen_at,created_at)
			SELECT ?,?,?,?,?,?,? FROM identity
			WHERE NOT (${signupAccessBlockedSql}) AND (${signupProofOrLegacySql})
			AND (?=1 OR EXISTS(SELECT 1 FROM beta_access WHERE email=identity.email AND status='APPROVED'))
			AND (?=0 OR EXISTS(SELECT 1 FROM signup_verification_flows flow WHERE flow.id=? AND flow.confirmation_receipt=?
				AND flow.consumed_at IS NOT NULL AND flow.superseded_at IS NULL AND flow.expires_at>?))`)
			.bind(isBetaAdmin(c.env, user.email) ? 1 : 0, user.id, user.googleSub, user.email, sessionId, user.id, await sha256(sessionToken),
				await sha256(csrfToken), expires.toISOString(), now, now,
				betaAccessMode(c.env) === "OPEN" || isBetaAdmin(c.env, user.email) ? 1 : 0,
				signupFlow ? 1 : 0, signupFlow?.id || "", signupFlow?.receipt || "", now).run();
		if (!created.meta.changes) throw new AuthenticationError();
	} else {
		await createSession(c.env, user.id, await sha256(sessionToken), await sha256(csrfToken), expires.toISOString());
	}
	const options = {
		secure: secureCookie(c),
		sameSite: "Lax" as const,
		path: "/",
		maxAge: Math.floor((expires.getTime() - Date.now()) / 1000),
	};
	setCookie(c, cookieName(c, SESSION_COOKIE), sessionToken, {
		...options,
		httpOnly: true,
	});
	setCookie(c, cookieName(c, CSRF_COOKIE), csrfToken, {
		...options,
		httpOnly: false,
		sameSite: "Strict",
	});
}

export async function authenticatedUser(
	c: Parameters<typeof getCookie>[0],
): Promise<AuthenticatedUser | null> {
	const token = getCookie(c, cookieName(c, SESSION_COOKIE));
	if (!token) return null;
	const session = await findSession(c.env, await sha256(token));
	if (!session) return null;
	if (signupVerificationEnabled(c.env) && await signupAccessBlocked(c.env, session.google_sub, session.email)) {
		await revokeSession(c.env, session.id);
		return null;
	}
	if (!(await hasBetaAccess(c.env, session.email))) {
		await revokeSession(c.env, session.id);
		return null;
	}
	if (!(await signupIdentityAllowed(c.env, session.google_sub, session.email))) return null;
	c.set("sessionId", session.id);
	c.set("csrfHash", session.csrf_hash);
	await touchSession(c.env, session.id, session.last_seen_at);
	return {
		id: session.user_id,
		googleSub: session.google_sub,
		email: session.email,
		name: session.name,
		image: session.image,
	};
}

export const requireUser = createMiddleware<AppEnvironment>(async (c, next) => {
	const user = await authenticatedUser(c);
	if (!user) throw new Error("Unauthorized session.");
	c.set("user", user);
	await next();
});

export async function requireCsrf(
	c: Parameters<typeof getCookie>[0],
): Promise<void> {
	const cookieToken = getCookie(c, cookieName(c, CSRF_COOKIE)) || "";
	const headerToken = c.req.header("X-CSRF-Token") || "";
	const expectedHash = c.get("csrfHash");
	if (
		!cookieToken ||
		!headerToken ||
		!expectedHash ||
		!safeEqual(cookieToken, headerToken) ||
		!safeEqual(await sha256(cookieToken), expectedHash)
	) {
		throw new Error("CSRF validation failed.");
	}
}

export async function logout(c: Parameters<typeof deleteCookie>[0]): Promise<void> {
	const sessionId = c.get("sessionId");
	if (sessionId) await revokeSession(c.env, sessionId);
	await supersedePendingSignup(c);
	deleteCookie(c, cookieName(c, SESSION_COOKIE), {
		path: "/",
		secure: secureCookie(c),
	});
	deleteCookie(c, cookieName(c, CSRF_COOKIE), {
		path: "/",
		secure: secureCookie(c),
	});
	clearPendingSignupCookies(c);
}

export function csrfCookieName(
	c: Parameters<typeof getCookie>[0],
): string {
	return cookieName(c, CSRF_COOKIE);
}

export function credentialProvider(value: string): CredentialProvider {
	const allowed: CredentialProvider[] = [
		"GOOGLE",
		"TAVILY",
		"HUNTER",
		"APOLLO",
		"GEMINI",
		"OPENAI",
		"ANTHROPIC",
	];
	const provider = value.toUpperCase() as CredentialProvider;
	if (!allowed.includes(provider)) throw new Error("Invalid credential provider.");
	return provider;
}

export async function decryptStoredCredential(
	c: Parameters<typeof getCookie>[0],
	provider: CredentialProvider,
	kind: "OAUTH_REFRESH_TOKEN" | "API_KEY" = "API_KEY",
): Promise<string> {
	const user = c.get("user");
	if (!user) throw new Error("Unauthorized session.");
	const { getCredential } = await import("./db");
	const record = await getCredential(c.env, user.id, kind, provider);
	if (!record) throw new Error(`${provider} is not configured.`);
	return decryptCredential(c.env, user.id, kind, provider, record);
}

export { secretHint };
