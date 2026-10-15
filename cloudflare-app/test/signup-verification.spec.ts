import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { Hono } from "hono";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import worker from "../src";
import type { AppBindings, AppEnvironment } from "../src/types";
import { createSession, upsertUser } from "../src/lib/db";
import { acceptVerifiedGoogleLogin } from "../src/lib/auth";
import { sha256 } from "../src/lib/encoding";
import { cleanupSignupVerification, confirmSignup, signupIdentityAllowed, startPendingSignup, verificationLink } from "../src/lib/signup-verification";
import { approveBetaEmail, denyBetaRequest, listBetaAccessAdmin, requestVerifiedBetaAccess, revokeBetaEmail } from "../src/lib/beta";
import { getOwnerAccessRoster } from "../src/lib/owner-activity";
import { fetchJson } from "../src/lib/fetch";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { openPayload } from "../src/lib/crypto";

const origin = "https://findinginternships.com";
const bindings: AppBindings = { ...env as AppBindings, APP_ORIGIN: origin, BETA_ACCESS_MODE: "ALLOWLIST",
	ENABLE_SIGNUP_EMAIL_VERIFICATION: "true", RESEND_API_KEY: "fictional-test-key-not-a-real-credential" };
type Profile = { googleSub: string; email: string; name: string; image: string };
type Signup = { profile: Profile; cookie: string; csrf: string; id: string };
type Mail = { to: string[]; text: string; idempotency: string; redirect: RequestRedirect | undefined };
let mails: Mail[] = [], mode: "accepted" | "rejected" | "timeout" | "missing-id" = "accepted";
let legacy: Profile;
let fixturePrivateKey: CryptoKey, fixtureJwk: Record<string, unknown>, fixtureIdToken = "";
const fresh = (): Profile => ({ googleSub: crypto.randomUUID(), email: `${crypto.randomUUID()}@example.test`, name: "Fictional member", image: "" });

beforeAll(async () => {
	const statements = JSON.parse((env as typeof env & { MIGRATION_STATEMENTS: string }).MIGRATION_STATEMENTS) as string[];
	await env.DB.batch(statements.map((sql) => env.DB.prepare(sql)));
	legacy = fresh();
	await upsertUser(bindings, legacy);
	await env.DB.prepare("INSERT INTO beta_access(email,status,created_at,updated_at) VALUES(?,'APPROVED',?,?)")
		.bind(legacy.email, new Date().toISOString(), new Date().toISOString()).run();
	expect(await signupIdentityAllowed(bindings, legacy.googleSub, legacy.email)).toBe(true);
	const pair = await generateKeyPair("RS256", { extractable: true });
	fixturePrivateKey = pair.privateKey;
	fixtureJwk = { ...await exportJWK(pair.publicKey), kid: "fictional-signup-jwt", alg: "RS256", use: "sig" };
});
beforeEach(() => {
	mails = []; mode = "accepted";
	vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
		if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: fixtureIdToken, access_token: "fictional-not-a-real-grant", scope: "openid email profile", expires_in: 300 });
		if (url === "https://www.googleapis.com/oauth2/v3/certs") return Response.json({ keys: [fixtureJwk] });
		if (url !== "https://api.resend.com/emails") throw Error("No real outbound requests are permitted.");
		const body = JSON.parse(String(init?.body)) as { to: string[]; text: string };
		mails.push({ ...body, idempotency: (init?.headers as Record<string, string>)["Idempotency-Key"]!, redirect: init?.redirect });
		if (mode === "rejected") return new Response('{"message":"fictional rejected delivery"}', { status: 422 });
		if (mode === "timeout") throw new DOMException("Fictional timeout", "AbortError");
		if (mode === "missing-id") return Response.json({});
		return Response.json({ id: crypto.randomUUID() });
	});
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function start(profile = fresh(), options: AppBindings = bindings): Promise<Signup> {
	const app = new Hono<AppEnvironment>();
	app.get("/fictional-google-callback", async (c) => {
		await startPendingSignup(c, { ...profile, emailVerified: true }, "/#my-jobs");
		return c.json({ pending: true });
	});
	const response = await app.request(`${origin}/fictional-google-callback`, undefined, options);
	expect(response.status).toBe(200);
	const cookies = response.headers.getSetCookie();
	const cookie = cookies.map((value) => value.split(";")[0]).join("; ");
	const csrf = /__Host-cc_signup_csrf=([^;]+)/.exec(cookie)![1]!;
	const id = /__Host-cc_signup_pending=([a-f0-9-]{36})\./.exec(cookie)![1]!;
	expect(cookie.includes("__Host-cc_session=")).toBe(false);
	return { profile, cookie, csrf, id };
}
async function call(path: string, signup?: Signup, method = "GET", body?: unknown, options: { csrf?: boolean; origin?: string; cookie?: string; env?: AppBindings } = {}) {
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`${origin}${path}`, { method,
		headers: { "Content-Type": "application/json", Origin: options.origin || origin,
			...(signup ? { Cookie: options.cookie ?? signup.cookie, ...(options.csrf === false ? {} : { "X-CSRF-Token": signup.csrf }) } : {}) },
		body: body === undefined ? undefined : JSON.stringify(body),
	}), options.env || bindings, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}
function mailToken(index = mails.length - 1): string {
	const url = /https:\/\/findinginternships\.com\/signup\/verify#[^\s]+/.exec(mails[index]!.text)?.[0];
	if (!url) throw new Error("Fictional verification link missing.");
	return new URLSearchParams(new URL(url).hash.slice(1)).get("t")!;
}
async function allowResend(signup: Signup) {
	await env.DB.prepare("UPDATE signup_verification_identities SET next_delivery_at=? WHERE google_sub=?")
		.bind(new Date(Date.now() - 1000).toISOString(), signup.profile.googleSub).run();
}
async function row(signup: Signup) {
	return env.DB.prepare("SELECT * FROM signup_verification_flows WHERE id=?").bind(signup.id).first<Record<string, unknown>>();
}
function withSession(signup: Signup, response: Response): Signup {
	const cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
	const csrf = /__Host-cc_csrf=([^;]+)/.exec(cookie)?.[1] || signup.csrf;
	return { ...signup, cookie, csrf };
}
async function oldPolicyConfirmation(signup: Signup, token: string) {
	const app = new Hono<AppEnvironment>();
	app.post("/fictional-old-confirmation", async (c) => {
		await confirmSignup(c, token);
		return c.json({ verified: true });
	});
	const response = await app.request(`${origin}/fictional-old-confirmation`, {
		method: "POST", headers: { Cookie: signup.cookie, Origin: origin, "X-CSRF-Token": signup.csrf },
	}, bindings);
	expect(response.status).toBe(200);
}
async function googleCallback(profile: Profile, mode: "login" | "request", emailVerified: boolean | null = true, previousCookies = "", callbackBindings = bindings) {
	const begun = await call(`/auth/google/${mode}`, undefined, "GET", undefined, { env: callbackBindings });
	expect(begun.status).toBe(302);
	const sealed = /__Host-cc_oauth=([^;]+)/.exec(begun.headers.get("set-cookie")!)![1]!;
	const state = await openPayload<{ state: string; nonce: string }>(callbackBindings, "google-oauth", sealed);
	fixtureIdToken = await new SignJWT({ nonce: state.nonce, email: profile.email,
		...(emailVerified === null ? {} : { email_verified: emailVerified }), name: profile.name })
		.setProtectedHeader({ alg: "RS256", kid: "fictional-signup-jwt" }).setIssuer("https://accounts.google.com")
		.setAudience(callbackBindings.GOOGLE_CLIENT_ID).setSubject(profile.googleSub).setIssuedAt().setExpirationTime("5m").sign(fixturePrivateKey);
	const ctx = createExecutionContext();
	const response = await worker.fetch(new Request(`${origin}/auth/google/callback?${new URLSearchParams({ state: state.state, code: "fictional-local-code" })}`,
		{ headers: { Cookie: `__Host-cc_oauth=${sealed}; ${previousCookies}` } }), callbackBindings, ctx);
	await waitOnExecutionContext(ctx);
	return response;
}

describe("local signup email proof with mocked delivery", () => {
	it.each(["login", "request"] as const)("wires actual mocked Google %s callback to pending proof, not access/session", async (mode) => {
		const profile = fresh(), response = await googleCallback(profile, mode);
		expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("/signup/pending");
		const cookies = response.headers.getSetCookie().join("; ");
		expect(cookies.includes("__Host-cc_signup_pending=")).toBe(true);
		expect(cookies.includes("__Host-cc_session=")).toBe(false);
		expect(mails.length).toBe(1);
		expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM beta_access_requests WHERE google_sub=?").bind(profile.googleSub).first<{ n: number }>())!.n).toBe(0);
	});
	it("rejects a mocked Google identity without verified email before extra mail or user creation", async () => {
		const profile = fresh(), response = await googleCallback(profile, "login", false);
		expect(response.status).not.toBe(302); expect(mails.length).toBe(0);
		expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE google_sub=?").bind(profile.googleSub).first<{ n: number }>())!.n).toBe(0);
	});
	it.each([false, null])("preserves legacy Google login when the optional email-verified claim is %s", async (emailVerified) => {
		await env.DB.prepare("UPDATE beta_access SET status='APPROVED' WHERE email=?").bind(legacy.email).run();
		const response = await googleCallback(legacy, "login", emailVerified);
		expect(response.status).toBe(302);
		expect(response.headers.get("location")).not.toBe("/signup/pending");
		expect(response.headers.getSetCookie().some((value) => value.startsWith("__Host-cc_session="))).toBe(true);
		expect(mails.length).toBe(0);
	});
	it("switching to an unverified Google identity clears only this browser's prior workspace cookies", async () => {
		await env.DB.prepare("UPDATE beta_access SET status='APPROVED' WHERE email=?").bind(legacy.email).run();
		const user = await acceptVerifiedGoogleLogin(bindings, legacy), token = crypto.randomUUID(), csrf = crypto.randomUUID();
		await createSession(bindings, user!.id, await sha256(token), await sha256(csrf), new Date(Date.now() + 3600000).toISOString());
		const cookies = `__Host-cc_session=${token}; __Host-cc_csrf=${csrf}`;
		const same = await googleCallback(legacy, "request", true, cookies);
		expect(same.headers.getSetCookie().some((value) => value.startsWith("__Host-cc_session=;") && value.includes("Max-Age=0"))).toBe(false);
		const changed = await googleCallback(fresh(), "login", true, cookies);
		expect(changed.headers.getSetCookie().some((value) => value.startsWith("__Host-cc_session=;") && value.includes("Max-Age=0"))).toBe(true);
		expect(changed.headers.get("location")).toBe("/signup/pending");
		const stored = await env.DB.prepare("SELECT revoked_at FROM sessions WHERE token_hash=?").bind(await sha256(token)).first<{ revoked_at: string | null }>();
		expect(stored?.revoked_at).toBeNull();
	});
	it("matching Google reauthentication repairs a lost pending-CSRF cookie without sending another email", async () => {
		const signup = await start(), token = mailToken();
		const pendingOnly = signup.cookie.split("; ").find((cookie) => cookie.startsWith("__Host-cc_signup_pending="))!;
		const response = await googleCallback(signup.profile, "login", true, pendingOnly);
		expect(response.status).toBe(302); expect(mails.length).toBe(1);
		const csrfCookie = response.headers.getSetCookie().find((value) => value.startsWith("__Host-cc_signup_csrf="))!.split(";")[0]!;
		const newCsrf = csrfCookie.slice(csrfCookie.indexOf("=") + 1);
		const repaired = { ...signup, cookie: `${pendingOnly}; ${csrfCookie}`, csrf: newCsrf };
		expect((await call("/api/signup-verification/confirm", repaired, "POST", { token })).status).toBe(200);
	});
	it("freezes actual pre-activation users once, not future approved emails/admin identities or rollback-created users", async () => {
		expect(await signupIdentityAllowed(bindings, legacy.googleSub, legacy.email)).toBe(true);
		const invited = fresh();
		await env.DB.prepare("INSERT INTO beta_access(email,status,created_at,updated_at) VALUES(?,'APPROVED',?,?)")
			.bind(invited.email, new Date().toISOString(), new Date().toISOString()).run();
		expect(await acceptVerifiedGoogleLogin(bindings, invited)).toBeNull();
		await upsertUser({ ...bindings, ENABLE_SIGNUP_EMAIL_VERIFICATION: "false" }, invited);
		expect(await signupIdentityAllowed(bindings, invited.googleSub, invited.email)).toBe(false);
		expect(await signupIdentityAllowed({ ...bindings, BETA_ADMIN_EMAILS: invited.email }, invited.googleSub, invited.email)).toBe(false);
		expect(mails.length).toBe(0);
	});
	it("creates pending-only cookies, a single recipient-bound delivery and hash-only expiring proof", async () => {
		const signup = await start(), token = mailToken(), stored = await row(signup);
		expect(mails.length).toBe(1); expect(mails[0]!.to).toEqual([signup.profile.email]);
		expect(mails[0]!.redirect).toBe("manual"); expect(mails[0]!.idempotency.startsWith("signup-verification:")).toBe(true);
		expect(stored?.purpose).toBe("SIGNUP"); expect(stored?.delivery_status).toBe("ACCEPTED");
		expect(stored?.link_hash).toBe(await sha256(token));
		expect(JSON.stringify(stored).includes(token)).toBe(false);
		expect(Date.parse(String(stored?.link_expires_at)) - Date.parse(String(stored?.created_at))).toBeLessThanOrEqual(1801000);
		const session = await (await call("/api/session", signup)).json<{ authenticated: boolean }>();
		expect(session.authenticated).toBe(false);
		for (const path of ["/api/jobs", "/api/job-states", "/api/analytics", "/api/prospects", "/auth/google/connect"]) expect((await call(path, signup)).status).toBe(401);
		expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE google_sub=?").bind(signup.profile.googleSub).first<{ n: number }>())!.n).toBe(0);
	});
	it("scanner GET/HEAD and status reads neither consume proof nor create a session or beta approval", async () => {
		const signup = await start();
		for (const method of ["GET", "HEAD"]) {
			const response = await call("/signup/verify", signup, method);
			expect(response.status).toBe(200); expect(response.headers.get("referrer-policy")).toBe("no-referrer");
			expect(response.headers.get("cache-control")).toBe("no-store"); expect(response.headers.get("set-cookie")).toBeNull();
		}
		expect((await call("/api/signup-verification", signup)).status).toBe(200);
		expect((await row(signup))?.consumed_at).toBeNull();
		expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM beta_access_requests WHERE google_sub=?").bind(signup.profile.googleSub).first<{ n: number }>())!.n).toBe(0);
	});
	it("explicit confirmation atomically admits only its bound identity and creates one standard session without owner approval", async () => {
		const signup = await start(), token = mailToken();
		const responses = await Promise.all([call("/api/signup-verification/confirm", signup, "POST", { token }), call("/api/signup-verification/confirm", signup, "POST", { token })]);
		expect(responses.map((r) => r.status).sort()).toEqual([200, 409]);
		const success = responses.find((r) => r.status === 200)!;
		expect(await success.json()).toEqual({ emailVerified: true, fullSessionCreated: true, redirectTo: "/#my-jobs" });
		const sessionCookie = success.headers.getSetCookie().find((value) => value.startsWith("__Host-cc_session="))!;
		expect(sessionCookie).toContain("HttpOnly"); expect(sessionCookie).toContain("Secure"); expect(sessionCookie).toContain("SameSite=Lax");
		expect(sessionCookie).not.toContain("Domain=");
		expect(success.headers.getSetCookie().find((value) => value.startsWith("__Host-cc_csrf="))).toContain("SameSite=Strict");
		expect(success.headers.getSetCookie().some((value) => value.startsWith("__Host-cc_signup_pending=;"))).toBe(true);
		expect(await signupIdentityAllowed(bindings, signup.profile.googleSub, signup.profile.email)).toBe(true);
		expect(await acceptVerifiedGoogleLogin(bindings, signup.profile)).toBeTruthy();
		const requests = await env.DB.prepare("SELECT status FROM beta_access_requests WHERE google_sub=?").bind(signup.profile.googleSub).all<{ status: string }>();
		expect(requests.results).toEqual([]);
		const signedIn = withSession(signup, success);
		expect((await (await call("/api/session", signedIn)).json<{ authenticated: boolean; isBetaAdmin: boolean }>())).toMatchObject({ authenticated: true, isBetaAdmin: false });
		expect((await call("/api/jobs", signedIn)).status).toBe(200);
		expect((await call("/api/beta/admin/access", signedIn)).status).toBe(403);
		expect((await call("/auth/google/connect", signedIn)).status).toBe(302);
		const sessions = await env.DB.prepare("SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.google_sub=?")
			.bind(signup.profile.googleSub).first<{ n: number }>();
		expect(sessions!.n).toBe(1);
		expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM beta_acceptance_notifications WHERE email=?").bind(signup.profile.email).first<{ n: number }>())!.n).toBe(0);
		expect((await listBetaAccessAdmin(bindings)).access.find((entry) => entry.email === signup.profile.email)?.grantSource).toBe("EMAIL_VERIFIED");
		expect((await getOwnerAccessRoster(bindings, {})).entries.find((entry) => entry.email === signup.profile.email)?.source).toBe("EMAIL_VERIFIED");
	});
	it("approved invite still needs proof; proof followed by normal Google login can retain the same new account identity", async () => {
		const profile = fresh();
		await env.DB.prepare("INSERT INTO beta_access(email,status,created_at,updated_at) VALUES(?,'APPROVED',?,?)")
			.bind(profile.email, new Date().toISOString(), new Date().toISOString()).run();
		expect(await acceptVerifiedGoogleLogin(bindings, profile)).toBeNull();
		const signup = await start(profile), token = mailToken();
		const confirmed = await call("/api/signup-verification/confirm", signup, "POST", { token });
		expect(await confirmed.json()).toMatchObject({ fullSessionCreated: true });
		const first = await acceptVerifiedGoogleLogin(bindings, profile), second = await acceptVerifiedGoogleLogin(bindings, profile);
		expect(first?.id).toBe(second?.id); expect(first?.id).toBeTruthy();
		const loggedIn = await googleCallback(profile, "login", true, signup.cookie);
		expect(loggedIn.status).toBe(302); expect(loggedIn.headers.get("location")).toBe("/");
		const fullCookies = loggedIn.headers.getSetCookie().map((cookie) => cookie.split(";")[0]).join("; ");
		const signedIn = { ...signup, cookie: fullCookies };
		expect((await (await call("/api/session", signedIn)).json<{ authenticated: boolean }>()).authenticated).toBe(true);
	});
	it("rejects cross-browser/account tokens, missing pending/CSRF and foreign origins without disclosure or delivery", async () => {
		const a = await start(), token = mailToken(), b = await start(), count = mails.length;
		expect((await call("/api/signup-verification/confirm", b, "POST", { token })).status).toBe(409);
		expect((await call("/api/signup-verification/confirm", undefined, "POST", { token })).status).toBe(401);
		expect((await call("/api/signup-verification/confirm", a, "POST", { token }, { csrf: false })).status).toBe(401);
		expect((await call("/api/signup-verification/confirm", a, "POST", { token }, { origin: "https://untrusted.example" })).status).not.toBe(200);
		expect((await call("/api/signup-verification/resend", a, "POST", { email: "recipient@example.test" })).status).toBe(400);
		expect(mails.length).toBe(count);
		expect((await row(a))?.consumed_at).toBeNull(); expect((await row(b))?.consumed_at).toBeNull();
	});
	it.each(["login", "request"] as const)("admits a pre-change verified pending applicant on Google %s without another email or owner decision", async (mode) => {
		const signup = await start(), token = mailToken();
		await oldPolicyConfirmation(signup, token);
		await requestVerifiedBetaAccess(bindings, signup.profile);
		const other = fresh();
		await requestVerifiedBetaAccess(bindings, other);
		await env.DB.prepare("UPDATE signup_verification_flows SET expires_at=? WHERE id=?")
			.bind(new Date(Date.now() - 1000).toISOString(), signup.id).run();
		const status = await call("/api/signup-verification", signup);
		expect(status.headers.get("set-cookie")).toBeNull();
		expect((await status.json<{ verified: boolean }>()).verified).toBe(true);
		expect((await (await call("/api/session", signup)).json<{ authenticated: boolean }>()).authenticated).toBe(false);
		const response = await googleCallback(signup.profile, mode);
		expect(response.status).toBe(302); expect(response.headers.get("location")).toBe("/");
		expect(mails.length).toBe(1);
		const session = withSession(signup, response);
		expect((await (await call("/api/session", session)).json<{ authenticated: boolean }>()).authenticated).toBe(true);
		expect((await env.DB.prepare("SELECT status FROM beta_access_requests WHERE google_sub=?")
			.bind(signup.profile.googleSub).first<{ status: string }>())?.status).toBe("APPROVED");
		expect((await env.DB.prepare("SELECT status FROM beta_access_requests WHERE google_sub=?")
			.bind(other.googleSub).first<{ status: string }>())?.status).toBe("PENDING");
		expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM beta_acceptance_notifications WHERE email=?")
			.bind(signup.profile.email).first<{ n: number }>())!.n).toBe(0);
	});
	it.each(["DENIED", "REVOKED"] as const)("cannot self-admit, consume a link, or send more mail after an explicit %s decision", async (decision) => {
		const signup = await start(), token = mailToken(), now = new Date().toISOString();
		if (decision === "DENIED") {
			await env.DB.prepare("INSERT INTO beta_access_requests(id,email,google_sub,status,requested_at,updated_at) VALUES(?,?,?,'DENIED',?,?)")
				.bind(crypto.randomUUID(), signup.profile.email, signup.profile.googleSub, now, now).run();
		} else {
			await env.DB.prepare("INSERT INTO beta_access(email,status,created_at,updated_at) VALUES(?,'REVOKED',?,?)")
				.bind(signup.profile.email, now, now).run();
		}
		expect((await call("/api/signup-verification/confirm", signup, "POST", { token })).status).toBe(403);
		expect((await row(signup))?.consumed_at).toBeNull();
		expect((await call("/api/signup-verification/resend", signup, "POST", {})).status).toBe(403);
		expect((await (await call("/api/signup-verification", signup)).json<{ restricted: boolean }>()).restricted).toBe(true);
		expect((await googleCallback(signup.profile, "login")).status).toBe(403);
		expect((await googleCallback({ ...signup.profile, email: `${crypto.randomUUID()}@example.test` }, "login")).status).toBe(403);
		expect(mails.length).toBe(1);
		expect((await env.DB.prepare("SELECT COUNT(*) AS n FROM users WHERE google_sub=?")
			.bind(signup.profile.googleSub).first<{ n: number }>())!.n).toBe(0);
	});
	it("requires an explicit owner restoration for an already verified denied applicant", async () => {
		const signup = await start(), token = mailToken(), now = new Date().toISOString();
		await oldPolicyConfirmation(signup, token);
		await env.DB.prepare("INSERT INTO beta_access_requests(id,email,google_sub,status,requested_at,updated_at) VALUES(?,?,?,'DENIED',?,?)")
			.bind(crypto.randomUUID(), signup.profile.email, signup.profile.googleSub, now, now).run();
		expect((await googleCallback(signup.profile, "login")).status).toBe(403);
		const owner = await env.DB.prepare("SELECT id FROM users WHERE google_sub=?").bind(legacy.googleSub).first<{ id: string }>();
		await approveBetaEmail(bindings, signup.profile.email, owner!.id);
		const response = await googleCallback(signup.profile, "login");
		expect(response.status).toBe(302);
		expect((await (await call("/api/session", withSession(signup, response))).json<{ authenticated: boolean; isBetaAdmin: boolean }>()))
			.toMatchObject({ authenticated: true, isBetaAdmin: false });
		expect(mails.length).toBe(1);
	});
	it("revocation and a subsequent denial terminate self-service access and cannot be bypassed by sign-in", async () => {
		const signup = await start(), token = mailToken();
		const confirmed = await call("/api/signup-verification/confirm", signup, "POST", { token });
		const session = withSession(signup, confirmed);
		const owner = await env.DB.prepare("SELECT id FROM users WHERE google_sub=?").bind(legacy.googleSub).first<{ id: string }>();
		await revokeBetaEmail(bindings, signup.profile.email, owner!.id);
		expect((await call("/api/jobs", session)).status).toBe(401);
		expect((await googleCallback(signup.profile, "login")).status).toBe(403);
		await approveBetaEmail(bindings, signup.profile.email, owner!.id);
		const restored = withSession(signup, await googleCallback(signup.profile, "login"));
		const requestId = crypto.randomUUID(), now = new Date().toISOString();
		await env.DB.prepare("INSERT INTO beta_access_requests(id,email,google_sub,status,requested_at,updated_at) VALUES(?,?,?,'PENDING',?,?)")
			.bind(requestId, signup.profile.email, signup.profile.googleSub, now, now).run();
		await denyBetaRequest(bindings, requestId);
		expect((await call("/api/jobs", restored)).status).toBe(401);
		expect((await googleCallback(signup.profile, "login")).status).toBe(403);
		expect((await env.DB.prepare("SELECT google_sub FROM beta_access_requests WHERE id=?").bind(requestId)
			.first<{ google_sub: string }>())?.google_sub).toBe(signup.profile.googleSub);
	});
	it("rejects a valid pending confirmation when the browser has switched to another signed-in account", async () => {
		const signup = await start(), token = mailToken();
		const owner = await env.DB.prepare("SELECT id FROM users WHERE google_sub=?").bind(legacy.googleSub).first<{ id: string }>();
		const sessionToken = crypto.randomUUID(), csrf = crypto.randomUUID();
		await createSession(bindings, owner!.id, await sha256(sessionToken), await sha256(csrf), new Date(Date.now() + 3600000).toISOString());
		const response = await call("/api/signup-verification/confirm", signup, "POST", { token },
			{ cookie: `${signup.cookie}; __Host-cc_session=${sessionToken}; __Host-cc_csrf=${csrf}` });
		expect(response.status).toBe(409); expect(response.headers.get("set-cookie")).toBeNull();
		expect((await row(signup))?.consumed_at).toBeNull();
	});
	it("rejects a different Google subject claiming an existing account email without attaching its data", async () => {
		const response = await googleCallback({ ...fresh(), email: legacy.email }, "login");
		expect(response.status).toBe(403); expect(mails.length).toBe(0);
		expect(response.headers.getSetCookie().some((value) => value.startsWith("__Host-cc_session="))).toBe(false);
	});
	it("an account switch between proof consumption and session creation prevents a stale signup session", async () => {
		const signup = await start(), token = mailToken(), originalPrepare = bindings.DB.prepare.bind(bindings.DB);
		let switched = false, replacement: Response | undefined;
		const guarded = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
			get(target, key, receiver) {
				if (key === "bind") return (...values: unknown[]) => guarded(target.bind(...values));
				if (key === "run") return async () => {
					if (!switched) {
						switched = true;
						replacement = await googleCallback(legacy, "login", true, signup.cookie);
					}
					return target.run();
				};
				return Reflect.get(target, key, receiver);
			},
		});
		vi.spyOn(bindings.DB, "prepare").mockImplementation((sql) => {
			const statement = originalPrepare(sql);
			return sql.includes("INSERT INTO sessions(") ? guarded(statement) : statement;
		});
		const response = await call("/api/signup-verification/confirm", signup, "POST", { token });
		expect(switched).toBe(true); expect(replacement?.status).toBe(302); expect(response.status).toBe(401);
		expect(response.headers.getSetCookie().some((value) => value.startsWith("__Host-cc_session="))).toBe(false);
		expect((await row(signup))?.superseded_at).toBeTruthy();
	});
	it("a delayed confirmation cookie cannot restore the prior account after another Google identity signs in", async () => {
		const signup = await start(), token = mailToken();
		const confirmed = await call("/api/signup-verification/confirm", signup, "POST", { token });
		expect(confirmed.status).toBe(200);
		const delayed = withSession(signup, confirmed);
		const replacement = await googleCallback(legacy, "login", true, signup.cookie);
		expect(replacement.status).toBe(302);
		expect((await call("/api/jobs", delayed)).status).toBe(401);
		expect((await call("/api/jobs", withSession(signup, replacement))).status).toBe(200);
		expect((await row(signup))?.superseded_at).toBeTruthy();
		expect((await call("/api/signup-verification/confirm", signup, "POST", { token })).status).toBe(409);
	});
	it("preserves configured-owner beta overrides but still requires proof and rejects collision/deletion", async () => {
		const profile = fresh(), ownerEnv = { ...bindings, BETA_ADMIN_EMAILS: profile.email }, now = new Date().toISOString();
		await env.DB.prepare("INSERT INTO beta_access(email,status,created_at,updated_at) VALUES(?,'REVOKED',?,?)").bind(profile.email, now, now).run();
		await env.DB.prepare("INSERT INTO beta_access_requests(id,email,google_sub,status,requested_at,updated_at) VALUES(?,?,?,'DENIED',?,?)")
			.bind(crypto.randomUUID(), profile.email, profile.googleSub, now, now).run();
		const pending = await googleCallback(profile, "login", true, "", ownerEnv);
		expect(pending.status).toBe(302); expect(pending.headers.get("location")).toBe("/signup/pending");
		expect(pending.headers.getSetCookie().some((value) => value.startsWith("__Host-cc_session="))).toBe(false);
		const cookie = pending.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
		const signup: Signup = { profile, cookie, csrf: /__Host-cc_signup_csrf=([^;]+)/.exec(cookie)![1]!,
			id: /__Host-cc_signup_pending=([a-f0-9-]{36})\./.exec(cookie)![1]! };
		const confirmed = await call("/api/signup-verification/confirm", signup, "POST", { token: mailToken() }, { env: ownerEnv });
		expect(confirmed.status).toBe(200);
		const session = withSession(signup, confirmed);
		expect(await (await call("/api/session", session, "GET", undefined, { env: ownerEnv })).json())
			.toMatchObject({ authenticated: true, isBetaAdmin: true });
		expect((await env.DB.prepare("SELECT status FROM beta_access WHERE email=?").bind(profile.email).first<{ status: string }>())?.status).toBe("REVOKED");
		expect((await googleCallback({ ...fresh(), email: profile.email }, "login", true, "", ownerEnv)).status).toBe(403);
		await env.DB.prepare("UPDATE users SET deleted_at=? WHERE google_sub=?").bind(new Date().toISOString(), profile.googleSub).run();
		expect((await call("/api/jobs", session, "GET", undefined, { env: ownerEnv })).status).toBe(401);
		expect((await googleCallback(profile, "login", true, "", ownerEnv)).status).toBe(403);
	});
	it("retains the existing configured legacy owner's optional-claim and ordinary revocation override", async () => {
		const ownerEnv = { ...bindings, BETA_ADMIN_EMAILS: legacy.email };
		await env.DB.prepare("UPDATE beta_access SET status='REVOKED' WHERE email=?").bind(legacy.email).run();
		try {
			const response = await googleCallback(legacy, "login", false, "", ownerEnv);
			expect(response.status).toBe(302);
			const signup: Signup = { profile: legacy, cookie: "", csrf: "", id: "" };
			expect(await (await call("/api/session", withSession(signup, response), "GET", undefined, { env: ownerEnv })).json())
				.toMatchObject({ authenticated: true, isBetaAdmin: true });
			expect(mails.length).toBe(0);
		} finally {
			await env.DB.prepare("UPDATE beta_access SET status='APPROVED' WHERE email=?").bind(legacy.email).run();
		}
	});
	it.each(["revoked", "deleted"] as const)("does not issue a session if the account is %s at the final session write", async (change) => {
		const signup = await start(), token = mailToken();
		const originalPrepare = bindings.DB.prepare.bind(bindings.DB);
		const guarded = (statement: D1PreparedStatement): D1PreparedStatement => new Proxy(statement, {
			get(target, key, receiver) {
				if (key === "bind") return (...values: unknown[]) => guarded(target.bind(...values));
				if (key === "run") return async () => {
					if (change === "revoked") await originalPrepare("UPDATE beta_access SET status='REVOKED' WHERE email=?").bind(signup.profile.email).run();
					else await originalPrepare("UPDATE users SET deleted_at=? WHERE google_sub=?").bind(new Date().toISOString(), signup.profile.googleSub).run();
					return target.run();
				};
				return Reflect.get(target, key, receiver);
			},
		});
		vi.spyOn(bindings.DB, "prepare").mockImplementation((sql) => {
			const statement = originalPrepare(sql);
			return sql.includes("INSERT INTO sessions(") ? guarded(statement) : statement;
		});
		const response = await call("/api/signup-verification/confirm", signup, "POST", { token });
		expect(response.status).toBe(401);
		expect(response.headers.getSetCookie().some((value) => value.startsWith("__Host-cc_session="))).toBe(false);
		expect((await originalPrepare("SELECT COUNT(*) AS n FROM sessions s JOIN users u ON u.id=s.user_id WHERE u.google_sub=?")
			.bind(signup.profile.googleSub).first<{ n: number }>())!.n).toBe(0);
	});
	it("resend is concurrent-throttled, bounded to three attempts/hour and supersedes old links", async () => {
		const signup = await start(), original = mailToken();
		expect((await call("/api/signup-verification/resend", signup, "POST", {})).status).toBe(429);
		await allowResend(signup);
		const attempts = await Promise.all([call("/api/signup-verification/resend", signup, "POST", {}), call("/api/signup-verification/resend", signup, "POST", {})]);
		expect(attempts.map((r) => r.status).sort()).toEqual([200, 429]); expect(mails.length).toBe(2);
		expect(mails[0]!.idempotency === mails[1]!.idempotency).toBe(false);
		expect((await call("/api/signup-verification/confirm", signup, "POST", { token: original })).status).toBe(409);
		await allowResend(signup); expect((await call("/api/signup-verification/resend", signup, "POST", {})).status).toBe(200);
		await allowResend(signup); expect((await call("/api/signup-verification/resend", signup, "POST", {})).status).toBe(429);
		expect(mails.length).toBe(3);
		expect((await call("/api/signup-verification/confirm", signup, "POST", { token: mailToken() })).status).toBe(200);
	});
	it("expiry and replaced Google signup fail closed, even for the same subject in another browser", async () => {
		const signup = await start(), token = mailToken();
		await env.DB.prepare("UPDATE signup_verification_flows SET link_expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), signup.id).run();
		expect((await call("/api/signup-verification/confirm", signup, "POST", { token })).status).toBe(400);
		const replacement = await start(signup.profile);
		expect((await row(signup))?.superseded_at).toBeTruthy();
		expect((await call("/api/signup-verification/confirm", signup, "POST", { token })).status).toBe(409);
		await env.DB.prepare("UPDATE signup_verification_flows SET expires_at=? WHERE id=?").bind(new Date(Date.now() - 1000).toISOString(), replacement.id).run();
		expect((await call("/api/signup-verification/resend", replacement, "POST", {})).status).toBe(400);
		expect(await signupIdentityAllowed(bindings, signup.profile.googleSub, signup.profile.email)).toBe(false);
	});
	it.each(["rejected", "timeout", "missing-id"] as const)("makes %s delivery visibly incomplete with exactly one invocation", async (failure) => {
		mode = failure; const signup = await start();
		const status = await (await call("/api/signup-verification", signup)).json<{ delivery: string; verified: boolean }>();
		expect(status.delivery).toBe(failure === "rejected" ? "FAILED" : "UNCERTAIN");
		expect(status.verified).toBe(false); expect(mails.length).toBe(1);
		expect(await signupIdentityAllowed(bindings, signup.profile.googleSub, signup.profile.email)).toBe(false);
	});
	it("a missing key never calls a provider, claims sent, or grants access; resend remains throttled", async () => {
		const signup = await start(fresh(), { ...bindings, RESEND_API_KEY: undefined });
		expect(mails.length).toBe(0);
		expect((await row(signup))?.delivery_status).toBe("NOT_CONFIGURED");
		expect((await call("/api/signup-verification/resend", signup, "POST", {}, { env: { ...bindings, RESEND_API_KEY: undefined } })).status).toBe(429);
		expect((await (await call("/api/session", signup)).json<{ authenticated: boolean }>()).authenticated).toBe(false);
	});
	it("does not let a post-activation unverified identity's accidentally created full session bypass private gates", async () => {
		const profile = fresh(), user = await upsertUser(bindings, profile), token = crypto.randomUUID(), csrf = crypto.randomUUID();
		await env.DB.prepare("INSERT INTO beta_access(email,status,created_at,updated_at) VALUES(?,'APPROVED',?,?)")
			.bind(profile.email, new Date().toISOString(), new Date().toISOString()).run();
		await createSession(bindings, user.id, await sha256(token), await sha256(csrf), new Date(Date.now() + 3600000).toISOString());
		const fake: Signup = { profile, cookie: `__Host-cc_session=${token}; __Host-cc_csrf=${csrf}`, csrf, id: crypto.randomUUID() };
		expect((await call("/api/analytics", fake)).status).toBe(401);
		expect((await call("/auth/google/connect", fake)).status).toBe(401);
	});
	it("legacy approved sessions retain access and revocation still applies, without extra messages", async () => {
		const user = await acceptVerifiedGoogleLogin(bindings, legacy), token = crypto.randomUUID(), csrf = crypto.randomUUID();
		expect(user).toBeTruthy();
		await createSession(bindings, user!.id, await sha256(token), await sha256(csrf), new Date(Date.now() + 3600000).toISOString());
		const signup: Signup = { profile: legacy, cookie: `__Host-cc_session=${token}; __Host-cc_csrf=${csrf}`, csrf, id: "" };
		expect((await (await call("/api/session", signup)).json<{ authenticated: boolean }>()).authenticated).toBe(true);
		await env.DB.prepare("UPDATE beta_access SET status='REVOKED' WHERE email=?").bind(legacy.email).run();
		expect((await call("/api/analytics", signup)).status).toBe(401);
		expect(mails.length).toBe(0);
	});
	it("canonical links use fragments, never request Host/query, and aliases discard secret-bearing input", async () => {
		const token = "a".repeat(43), url = new URL(verificationLink(bindings, token));
		expect(url.origin).toBe(origin); expect(url.pathname).toBe("/signup/verify"); expect(url.search).toBe("");
		expect(new URLSearchParams(url.hash.slice(1)).get("t") === token).toBe(true);
		expect(() => verificationLink({ ...bindings, APP_ORIGIN: "https://untrusted.example" }, token)).toThrow();
		const ctx = createExecutionContext();
		const response = await worker.fetch(new Request("https://coffee-chat-agent.evanastonlowe.workers.dev/signup/verify?token=fictional"), bindings, ctx);
		await waitOnExecutionContext(ctx);
		expect(response.status).toBe(302); expect(response.headers.get("location")).toBe(`${origin}/signup/pending#`);
		expect(response.headers.get("location")!.includes("token")).toBe(false);
	});
	it("disabled feature leaves existing signup behavior available and never sends verification mail", async () => {
		const off = { ...bindings, ENABLE_SIGNUP_EMAIL_VERIFICATION: "false" }, profile = fresh();
		expect(await signupIdentityAllowed(off, profile.googleSub, profile.email)).toBe(true);
		expect((await call("/signup/pending", undefined, "GET", undefined, { env: off })).status).toBe(503);
		expect(mails.length).toBe(0);
		await expect(signupIdentityAllowed({ ...bindings, ENABLE_SIGNUP_EMAIL_VERIFICATION: "TRUE" }, profile.googleSub, profile.email)).rejects.toThrow();
	});
	it("soft account deletion removes proof/pending records and cannot restore legacy or future access", async () => {
		const signup = await start(), token = mailToken();
		expect((await call("/api/signup-verification/confirm", signup, "POST", { token })).status).toBe(200);
		const user = await acceptVerifiedGoogleLogin(bindings, signup.profile);
		await env.DB.prepare("UPDATE users SET deleted_at=? WHERE id=?").bind(new Date().toISOString(), user!.id).run();
		expect(await signupIdentityAllowed(bindings, signup.profile.googleSub, signup.profile.email)).toBe(false);
		expect(await row(signup)).toBeNull();
	});
	it("maintenance removes expired pending-only identity state but retains completed email proof", async () => {
		const pending = await start(), completed = await start(), token = mailToken();
		expect((await call("/api/signup-verification/confirm", completed, "POST", { token })).status).toBe(200);
		const old = new Date(Date.now() - 2 * 86400000).toISOString();
		for (const signup of [pending, completed]) {
			await env.DB.prepare("UPDATE signup_verification_flows SET expires_at=? WHERE id=?").bind(old, signup.id).run();
			await env.DB.prepare("UPDATE signup_verification_identities SET updated_at=? WHERE google_sub=?").bind(old, signup.profile.googleSub).run();
		}
		await cleanupSignupVerification(bindings);
		expect(await row(pending)).toBeNull(); expect(await row(completed)).toBeNull();
		expect(await env.DB.prepare("SELECT google_sub FROM signup_verification_identities WHERE google_sub=?").bind(pending.profile.googleSub).first()).toBeNull();
		expect(await signupIdentityAllowed(bindings, completed.profile.googleSub, completed.profile.email)).toBe(true);
	});
	it("Resend is narrowly POST/emails only and never retries even if a caller asks for four attempts", async () => {
		mode = "timeout";
		await expect(fetchJson("https://api.resend.com/emails", { method: "POST", body: { to: [], text: "fictional" }, attempts: 4 })).rejects.toThrow();
		expect(mails.length).toBe(1);
		for (const url of ["https://api.resend.com/domains", "https://api.resend.com/emails?recipient=other", "https://api.resend.com/emails#proof"]) {
			await expect(fetchJson(url, { method: "POST", body: {} })).rejects.toThrow();
		}
		expect(mails.length).toBe(1);
	});
	it("the real timeout signal aborts a single stalled mail request, without automatic retry", async () => {
		vi.useFakeTimers();
		vi.mocked(globalThis.fetch).mockImplementation((_input, init) => new Promise((_resolve, reject) => {
			init?.signal?.addEventListener("abort", () => reject(new DOMException("Fictional aborted request", "AbortError")), { once: true });
		}));
		const result = fetchJson("https://api.resend.com/emails", { method: "POST", body: { text: "fictional" }, timeoutMs: 1000, attempts: 4 }).then(() => false, () => true);
		await vi.advanceTimersByTimeAsync(1100);
		expect(await result).toBe(true);
		expect(globalThis.fetch).toHaveBeenCalledTimes(1);
	});
});
