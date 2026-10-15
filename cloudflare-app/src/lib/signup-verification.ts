import type { Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import type { AppBindings, AppEnvironment } from "../types";
import { isBetaAdmin, normalizeBetaEmail } from "./beta";
import { assertSignupAccessAllowed, signupAccessBlocked, signupAccessBlockedSql } from "./signup-access";
import { randomToken, sha256, safeEqual } from "./encoding";
import { AuthenticationError, ClientInputError, ConflictError, PublicHttpError } from "./errors";
import { assertSameOrigin } from "./http";
import { fetchJson, ProviderHttpError } from "./fetch";
import { logEvent } from "./log";

const FLOW_SECONDS = 3600, LINK_SECONDS = 1800, COOLDOWN_SECONDS = 60, WINDOW_SECONDS = 3600, MAX_DELIVERIES = 3;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
type DeliveryStatus = "READY" | "SENDING" | "ACCEPTED" | "FAILED" | "UNCERTAIN" | "NOT_CONFIGURED";
interface Flow {
	id: string; google_sub: string; email: string; purpose: "SIGNUP"; browser_hash: string; csrf_hash: string; return_to: string;
	created_at: string; expires_at: string; link_hash: string | null; link_expires_at: string | null; consumed_at: string | null;
	superseded_at: string | null; delivery_status: DeliveryStatus; delivery_attempt_id: string | null;
	failure_code: string | null; updated_at: string;
}
export function signupVerificationEnabled(env: AppBindings): boolean {
	if (env.ENABLE_SIGNUP_EMAIL_VERIFICATION === undefined || env.ENABLE_SIGNUP_EMAIL_VERIFICATION === "false") return false;
	if (env.ENABLE_SIGNUP_EMAIL_VERIFICATION === "true") return true;
	throw new Error("Signup email verification activation must be exactly true or false.");
}
export function signupCookieName(env: AppBindings, kind: "pending" | "csrf"): string {
	return `${new URL(env.APP_ORIGIN).protocol === "https:" ? "__Host-" : ""}cc_signup_${kind}`;
}
export function clearPendingSignupCookies(c: Context<AppEnvironment>): void {
	for (const kind of ["pending", "csrf"] as const) {
		const name = signupCookieName(c.env, kind);
		if (getCookie(c, name)) deleteCookie(c, name, { path: "/", secure: new URL(c.env.APP_ORIGIN).protocol === "https:" });
	}
}

async function activateLegacyCohort(env: AppBindings): Promise<void> {
	const policy = await env.DB.prepare("SELECT activated_at FROM signup_verification_policy WHERE singleton=1").first<{ activated_at: string | null }>();
	if (!policy) throw new Error("Signup verification migration is not ready.");
	if (policy.activated_at) return;
	const now = new Date().toISOString();
	await env.DB.batch([
		env.DB.prepare(`INSERT INTO signup_verification_legacy_users(user_id)
			SELECT id FROM users WHERE deleted_at IS NULL
			AND EXISTS(SELECT 1 FROM signup_verification_policy WHERE singleton=1 AND activated_at IS NULL)
			ON CONFLICT(user_id) DO NOTHING`),
		env.DB.prepare("UPDATE signup_verification_policy SET activated_at=? WHERE singleton=1 AND activated_at IS NULL").bind(now),
	]);
}

export async function signupIdentityAllowed(env: AppBindings, googleSub: string, email: string): Promise<boolean> {
	if (!signupVerificationEnabled(env)) return true;
	await activateLegacyCohort(env);
	const user = await env.DB.prepare(`SELECT u.deleted_at,l.user_id AS legacy_id FROM users u
		LEFT JOIN signup_verification_legacy_users l ON l.user_id=u.id WHERE u.google_sub=?`)
		.bind(googleSub).first<{ deleted_at: string | null; legacy_id: string | null }>();
	if (user?.deleted_at) return false;
	if (user?.legacy_id) return true;
	const proof = await env.DB.prepare("SELECT verified_at FROM signup_verification_identities WHERE google_sub=? AND email=?")
		.bind(googleSub, normalizeBetaEmail(email)).first<{ verified_at: string | null }>();
	return Boolean(proof?.verified_at);
}

function requireEnabled(env: AppBindings) {
	if (!signupVerificationEnabled(env)) throw new ClientInputError("Extra signup email verification is not enabled. Existing Google access is unchanged.");
}
export function verificationLink(env: AppBindings, value: string): string {
	if (!tokenPattern.test(value)) throw new Error("Invalid verification-link construction.");
	const origin = new URL(env.APP_ORIGIN);
	const local = origin.protocol === "http:" && ["127.0.0.1", "localhost"].includes(origin.hostname);
	if (origin.origin !== "https://findinginternships.com" && !local) throw new Error("Signup verification requires the trusted canonical origin.");
	const url = new URL("/signup/verify", origin.origin);
	url.hash = new URLSearchParams({ t: value }).toString();
	return url.toString();
}
async function flowById(env: AppBindings, id: string): Promise<Flow | null> {
	return env.DB.prepare("SELECT * FROM signup_verification_flows WHERE id=? AND purpose='SIGNUP'").bind(id).first<Flow>();
}
export async function pendingSignup(c: Context<AppEnvironment>): Promise<Flow | null> {
	requireEnabled(c.env);
	const cookie = getCookie(c, signupCookieName(c.env, "pending"));
	if (!cookie) return null;
	const match = /^([a-f0-9-]{36})\.([A-Za-z0-9_-]{43})$/.exec(cookie);
	if (!match) return null;
	const flow = await flowById(c.env, match[1]!);
	return flow && safeEqual(await sha256(match[2]!), flow.browser_hash) ? flow : null;
}
export async function supersedePendingSignup(
	c: Context<AppEnvironment>,
	nextIdentity?: { googleSub: string; email: string },
): Promise<void> {
	if (!signupVerificationEnabled(c.env)) return;
	const flow = await pendingSignup(c);
	if (!flow || (nextIdentity?.googleSub === flow.google_sub && normalizeBetaEmail(nextIdentity.email) === flow.email)) return;
	const now = new Date().toISOString();
	await c.env.DB.batch([
		c.env.DB.prepare(`UPDATE signup_verification_flows SET superseded_at=COALESCE(superseded_at,?),updated_at=?
			WHERE id=? AND browser_hash=?`).bind(now, now, flow.id, flow.browser_hash),
		c.env.DB.prepare(`UPDATE sessions SET revoked_at=? WHERE revoked_at IS NULL AND id IN (
			SELECT confirmation_receipt FROM signup_verification_flows WHERE id=? AND browser_hash=? AND superseded_at IS NOT NULL)`)
			.bind(now, flow.id, flow.browser_hash),
	]);
}
async function requirePending(c: Context<AppEnvironment>): Promise<Flow> {
	const flow = await pendingSignup(c);
	if (!flow) throw new AuthenticationError();
	return flow;
}
async function requireActive(env: AppBindings, flow: Flow) {
	await assertSignupAccessAllowed(env, flow.google_sub, flow.email);
	if (flow.consumed_at) throw new ConflictError("This signup has already been verified. Sign in with Google to continue.");
	if (flow.superseded_at) throw new ConflictError("This signup was replaced by another Google sign-in. Use the newest signup browser.");
	if (Date.parse(flow.expires_at) <= Date.now()) throw new ClientInputError("The signup session expired. Sign in with Google again.");
	const identity = await env.DB.prepare("SELECT email FROM signup_verification_identities WHERE google_sub=?").bind(flow.google_sub).first<{ email: string }>();
	if (identity?.email !== flow.email) throw new ConflictError("The verified Google identity changed. Sign in again.");
	const deleted = await env.DB.prepare("SELECT deleted_at FROM users WHERE google_sub=?").bind(flow.google_sub).first<{ deleted_at: string | null }>();
	if (deleted?.deleted_at) throw new AuthenticationError();
}
async function requirePendingCsrf(c: Context<AppEnvironment>, flow: Flow) {
	assertSameOrigin(c);
	const cookie = getCookie(c, signupCookieName(c.env, "csrf")) || "", header = c.req.header("X-CSRF-Token") || "";
	if (!tokenPattern.test(header) || !safeEqual(cookie, header) || !safeEqual(await sha256(header), flow.csrf_hash)) throw new AuthenticationError();
}

export async function startPendingSignup(c: Context<AppEnvironment>, profile: { googleSub: string; email: string; emailVerified: true }, returnTo = "/"): Promise<void> {
	requireEnabled(c.env); await activateLegacyCohort(c.env);
	if (profile.emailVerified !== true) throw new AuthenticationError();
	const email = normalizeBetaEmail(profile.email);
	if (!profile.googleSub || profile.googleSub.length > 240 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 320) throw new AuthenticationError();
	await assertSignupAccessAllowed(c.env, profile.googleSub, email);
	const deleted = await c.env.DB.prepare("SELECT deleted_at FROM users WHERE google_sub=?").bind(profile.googleSub).first<{ deleted_at: string | null }>();
	if (deleted?.deleted_at) throw new AuthenticationError();
	const existing = await pendingSignup(c);
	if (existing && existing.google_sub === profile.googleSub && existing.email === email && !existing.consumed_at &&
		!existing.superseded_at && Date.parse(existing.expires_at) > Date.now()) {
		const currentCsrf = getCookie(c, signupCookieName(c.env, "csrf")) || "";
		if (!tokenPattern.test(currentCsrf) || !safeEqual(await sha256(currentCsrf), existing.csrf_hash)) {
			const replacement = randomToken();
			await c.env.DB.prepare("UPDATE signup_verification_flows SET csrf_hash=? WHERE id=? AND consumed_at IS NULL AND superseded_at IS NULL")
				.bind(await sha256(replacement), existing.id).run();
			setCookie(c, signupCookieName(c.env, "csrf"), replacement, { httpOnly: false,
				secure: new URL(c.env.APP_ORIGIN).protocol === "https:", sameSite: "Strict", path: "/",
				maxAge: Math.max(0, Math.floor((Date.parse(existing.expires_at) - Date.now()) / 1000)) });
		}
		return;
	}
	const now = new Date().toISOString(), id = crypto.randomUUID(), browser = randomToken(), csrf = randomToken();
	await c.env.DB.batch([
		c.env.DB.prepare(`INSERT INTO signup_verification_identities(google_sub,email,verified_at,delivery_window_start,delivery_attempts,updated_at)
			VALUES(?,?,NULL,?,0,?) ON CONFLICT(google_sub) DO UPDATE SET
			verified_at=CASE WHEN signup_verification_identities.email=excluded.email THEN signup_verification_identities.verified_at ELSE NULL END,
			email=excluded.email,updated_at=excluded.updated_at`).bind(profile.googleSub, email, now, now),
		c.env.DB.prepare(`UPDATE signup_verification_flows SET superseded_at=?,updated_at=? WHERE google_sub=? AND consumed_at IS NULL AND superseded_at IS NULL`)
			.bind(now, now, profile.googleSub),
		c.env.DB.prepare(`INSERT INTO signup_verification_flows(id,google_sub,email,purpose,browser_hash,csrf_hash,return_to,created_at,expires_at,delivery_status,updated_at)
			VALUES(?,?,?,'SIGNUP',?,?,?,?,?,'READY',?)`)
			.bind(id, profile.googleSub, email, await sha256(browser), await sha256(csrf), returnTo, now, new Date(Date.now() + FLOW_SECONDS * 1000).toISOString(), now),
	]);
	const secure = new URL(c.env.APP_ORIGIN).protocol === "https:";
	setCookie(c, signupCookieName(c.env, "pending"), `${id}.${browser}`, { httpOnly: true, secure, sameSite: "Lax", path: "/", maxAge: FLOW_SECONDS });
	setCookie(c, signupCookieName(c.env, "csrf"), csrf, { httpOnly: false, secure, sameSite: "Strict", path: "/", maxAge: FLOW_SECONDS });
	const flow = await flowById(c.env, id);
	if (!flow) throw new Error("Signup pending state could not be read.");
	try {
		await deliverVerification(c.env, flow);
	} catch (error) {
		if (!(error instanceof PublicHttpError) || error.status !== 429) throw error;
		await c.env.DB.prepare("UPDATE signup_verification_flows SET delivery_status='FAILED',failure_code='THROTTLED',updated_at=? WHERE id=?")
			.bind(new Date().toISOString(), id).run();
		logEvent("warn", "signup_verification_delivery", { outcome: "FAILED", code: "THROTTLED" });
	}
}

async function finishDelivery(env: AppBindings, flow: Flow, attempt: string, status: DeliveryStatus, code: string | null, messageId: string | null = null) {
	await env.DB.prepare(`UPDATE signup_verification_flows SET delivery_status=?,failure_code=?,provider_message_id=?,updated_at=?
		WHERE id=? AND delivery_attempt_id=? AND consumed_at IS NULL`).bind(status, code, messageId, new Date().toISOString(), flow.id, attempt).run();
	logEvent(status === "ACCEPTED" ? "info" : "warn", "signup_verification_delivery", { outcome: status, code });
}
export async function deliverVerification(env: AppBindings, flow: Flow): Promise<DeliveryStatus> {
	await requireActive(env, flow);
	const raw = randomToken(), link = verificationLink(env, raw), attempt = crypto.randomUUID(), now = new Date().toISOString();
	const linkExpiresAt = new Date(Math.min(Date.now() + LINK_SECONDS * 1000, Date.parse(flow.expires_at))).toISOString();
	const windowCutoff = new Date(Date.now() - WINDOW_SECONDS * 1000).toISOString();
	const reservation = await env.DB.batch([
		env.DB.prepare(`UPDATE signup_verification_identities SET
			delivery_attempts=CASE WHEN delivery_window_start<=? THEN 1 ELSE delivery_attempts+1 END,
			delivery_window_start=CASE WHEN delivery_window_start<=? THEN ? ELSE delivery_window_start END,
			next_delivery_at=?,delivery_lease=?,updated_at=?
			WHERE google_sub=? AND email=? AND verified_at IS NULL AND (next_delivery_at IS NULL OR next_delivery_at<=?)
			AND (delivery_window_start<=? OR delivery_attempts<?)
			AND EXISTS(SELECT 1 FROM signup_verification_flows f WHERE f.id=? AND f.google_sub=signup_verification_identities.google_sub
				AND f.email=signup_verification_identities.email AND f.consumed_at IS NULL AND f.superseded_at IS NULL AND f.expires_at>?)`)
			.bind(windowCutoff, windowCutoff, now, new Date(Date.now() + COOLDOWN_SECONDS * 1000).toISOString(), attempt, now,
				flow.google_sub, flow.email, now, windowCutoff, MAX_DELIVERIES, flow.id, now),
		env.DB.prepare(`UPDATE signup_verification_flows SET link_hash=?,link_expires_at=?,delivery_attempt_id=?,delivery_status='SENDING',
			failure_code=NULL,provider_message_id=NULL,updated_at=? WHERE id=? AND consumed_at IS NULL AND superseded_at IS NULL
			AND EXISTS(SELECT 1 FROM signup_verification_identities i WHERE i.google_sub=signup_verification_flows.google_sub
				AND i.email=signup_verification_flows.email AND i.delivery_lease=?)`)
			.bind(await sha256(raw), linkExpiresAt, attempt, now, flow.id, attempt),
	]);
	if (!reservation[0]!.meta.changes || !reservation[1]!.meta.changes) {
		throw new PublicHttpError("Wait before requesting another verification message. At most three attempts per hour are allowed.", 429, "VERIFICATION_THROTTLED");
	}
	if (!env.RESEND_API_KEY?.trim()) {
		await finishDelivery(env, flow, attempt, "NOT_CONFIGURED", "MISSING_KEY");
		return "NOT_CONFIGURED";
	}
	let response: { id?: unknown };
	try {
		response = await fetchJson<{ id?: unknown }>("https://api.resend.com/emails", {
			method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Idempotency-Key": `signup-verification:${flow.id}:${attempt}` },
			body: { from: "Finding Internships <noreply@findinginternships.com>", to: [flow.email], subject: "Confirm your Finding Internships signup",
				text: `Confirm the email address used with your Google signup:\n\n${link}\n\nThis link expires at ${linkExpiresAt}, within 30 minutes and no later than your signup session. Open it in the original signup browser and explicitly confirm to finish signup and enter your workspace. Opening the link alone cannot sign you in. Google service connections and outreach permissions remain separate. If you did not start this signup, ignore this email.` },
			attempts: 1, timeoutMs: 20000, redirect: "manual",
		});
		if (typeof response.id !== "string" || !/^[a-f0-9-]{36}$/i.test(response.id)) throw new Error("Verification delivery result is uncertain.");
	} catch (error) {
		const rejected = error instanceof ProviderHttpError && [400, 401, 403, 404, 422, 429].includes(error.status);
		const status = rejected ? "FAILED" : "UNCERTAIN";
		await finishDelivery(env, flow, attempt, status, rejected ? "PROVIDER_REJECTED" : "CHECK_MAILBOX_BEFORE_RESEND");
		return status;
	}
	await finishDelivery(env, flow, attempt, "ACCEPTED", null, response.id);
	return "ACCEPTED";
}

export async function signupStatus(c: Context<AppEnvironment>) {
	const flow = await requirePending(c);
	const quota = await c.env.DB.prepare("SELECT next_delivery_at FROM signup_verification_identities WHERE google_sub=?").bind(flow.google_sub).first<{ next_delivery_at: string | null }>();
	const staleSend = flow.delivery_status === "SENDING" && Date.parse(flow.updated_at) < Date.now() - 45000;
	const identityVerified = await signupIdentityAllowed(c.env, flow.google_sub, flow.email);
	return { email: flow.email, verified: Boolean(flow.consumed_at) || identityVerified, expired: Date.parse(flow.expires_at) <= Date.now(),
		replaced: Boolean(flow.superseded_at), delivery: staleSend ? "UNCERTAIN" : flow.delivery_status,
		linkExpired: Boolean(flow.link_expires_at && Date.parse(flow.link_expires_at) <= Date.now()),
		linkExpiresAt: flow.link_expires_at, nextDeliveryAt: quota?.next_delivery_at || null,
		failureCode: flow.failure_code,
		csrfCookieName: signupCookieName(c.env, "csrf"), restricted: await signupAccessBlocked(c.env, flow.google_sub, flow.email),
		loginUrl: `/auth/google/login?returnTo=${encodeURIComponent(flow.return_to)}` };
}
export async function resendSignup(c: Context<AppEnvironment>) {
	const flow = await requirePending(c); await requirePendingCsrf(c, flow);
	const result = await deliverVerification(c.env, flow);
	if (result !== "ACCEPTED") throw new PublicHttpError("Email delivery is incomplete. Refresh status and check your mailbox before requesting a fresh link.", 409, `VERIFICATION_${result}`);
	return { acceptedByProvider: true, mailboxDeliveryConfirmed: false };
}
export async function confirmSignup(c: Context<AppEnvironment>, raw: unknown) {
	const flow = await requirePending(c); await requirePendingCsrf(c, flow); await requireActive(c.env, flow);
	if (typeof raw !== "string" || !tokenPattern.test(raw)) throw new ClientInputError("The verification link is invalid. Open the latest email.");
	const now = new Date().toISOString(), receipt = crypto.randomUUID();
	if (!flow.link_expires_at || Date.parse(flow.link_expires_at) <= Date.now()) throw new ClientInputError("This verification link expired. Request a new link.");
	const result = await c.env.DB.batch([
		c.env.DB.prepare(`UPDATE signup_verification_flows SET consumed_at=?,confirmation_receipt=?,updated_at=?
			WHERE id=? AND browser_hash=? AND link_hash=? AND purpose='SIGNUP' AND consumed_at IS NULL AND superseded_at IS NULL
			AND expires_at>? AND link_expires_at>? AND EXISTS(SELECT 1 FROM signup_verification_identities i
				WHERE i.google_sub=signup_verification_flows.google_sub AND i.email=signup_verification_flows.email)
			AND NOT EXISTS(SELECT 1 FROM users u WHERE u.google_sub=signup_verification_flows.google_sub AND u.deleted_at IS NOT NULL)
			AND NOT EXISTS(WITH identity AS (SELECT signup_verification_flows.google_sub AS google_sub,signup_verification_flows.email AS email,? AS owner_override)
				SELECT 1 FROM identity WHERE ${signupAccessBlockedSql})`)
			.bind(now, receipt, now, flow.id, flow.browser_hash, await sha256(raw), now, now, isBetaAdmin(c.env, flow.email) ? 1 : 0),
		c.env.DB.prepare(`UPDATE signup_verification_identities SET verified_at=?,updated_at=? WHERE google_sub=? AND email=?
			AND EXISTS(SELECT 1 FROM signup_verification_flows f WHERE f.id=? AND f.confirmation_receipt=?)`)
			.bind(now, now, flow.google_sub, flow.email, flow.id, receipt),
	]);
	if (!result[0]!.meta.changes || !result[1]!.meta.changes) throw new ConflictError("This link is invalid, replaced or already used. Open the latest email or sign in again.");
	return { googleSub: flow.google_sub, email: flow.email, returnTo: flow.return_to, flowId: flow.id, receipt };
}
export async function cleanupSignupVerification(env: AppBindings): Promise<void> {
	if (!signupVerificationEnabled(env)) return;
	const cutoff = new Date(Date.now() - 86400000).toISOString();
	await env.DB.batch([
		env.DB.prepare("DELETE FROM signup_verification_flows WHERE expires_at<?").bind(cutoff),
		env.DB.prepare(`DELETE FROM signup_verification_identities WHERE verified_at IS NULL AND updated_at<?
			AND NOT EXISTS(SELECT 1 FROM signup_verification_flows f WHERE f.google_sub=signup_verification_identities.google_sub)
			AND NOT EXISTS(SELECT 1 FROM users u WHERE u.google_sub=signup_verification_identities.google_sub)`).bind(cutoff),
	]);
}
