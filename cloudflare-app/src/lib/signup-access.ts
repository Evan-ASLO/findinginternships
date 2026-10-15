import type { AppBindings } from "../types";
import { hasBetaAccess, isBetaAdmin, normalizeBetaEmail } from "./beta";
import { PublicHttpError } from "./errors";

export const signupAccessBlockedSql = `
	EXISTS(SELECT 1 FROM users blocked WHERE
		(blocked.google_sub=identity.google_sub AND blocked.deleted_at IS NOT NULL)
		OR (blocked.email=identity.email AND blocked.google_sub!=identity.google_sub))
	OR (identity.owner_override=0 AND (EXISTS(SELECT 1 FROM beta_access access WHERE access.status='REVOKED' AND access.email IN (
		SELECT identity.email UNION SELECT email FROM users WHERE google_sub=identity.google_sub
		UNION SELECT email FROM signup_verification_identities WHERE google_sub=identity.google_sub))
	OR EXISTS(SELECT 1 FROM beta_access_requests denied WHERE denied.status='DENIED'
		AND (denied.google_sub=identity.google_sub OR denied.email IN (
			SELECT identity.email UNION SELECT email FROM users WHERE google_sub=identity.google_sub
			UNION SELECT email FROM signup_verification_identities WHERE google_sub=identity.google_sub))
		AND NOT EXISTS(SELECT 1 FROM beta_access restored WHERE restored.email=denied.email
			AND restored.status='APPROVED' AND julianday(restored.updated_at)>julianday(denied.updated_at)))))`;

export const signupProofOrLegacySql = `
	EXISTS(SELECT 1 FROM signup_verification_identities proof WHERE proof.google_sub=identity.google_sub
		AND proof.email=identity.email AND proof.verified_at IS NOT NULL)
	OR EXISTS(SELECT 1 FROM signup_verification_legacy_users legacy JOIN users registered ON registered.id=legacy.user_id
		WHERE registered.google_sub=identity.google_sub AND registered.deleted_at IS NULL)`;

export async function signupAccessBlocked(env: AppBindings, googleSub: string, email: string): Promise<boolean> {
	const result = await env.DB.prepare(`WITH identity(google_sub,email,owner_override) AS (VALUES(?,?,?))
		SELECT (${signupAccessBlockedSql}) AS blocked FROM identity`)
		.bind(googleSub, normalizeBetaEmail(email), isBetaAdmin(env, email) ? 1 : 0).first<{ blocked: number }>();
	if (!result) throw new Error("Account access restrictions could not be checked.");
	return Boolean(result.blocked);
}

export async function assertSignupAccessAllowed(env: AppBindings, googleSub: string, email: string): Promise<void> {
	if (await signupAccessBlocked(env, googleSub, email)) {
		throw new PublicHttpError("This account's access is restricted. Contact the site owner.", 403, "ACCESS_RESTRICTED");
	}
}

export async function admitVerifiedSignup(env: AppBindings, googleSub: string, emailValue: string): Promise<boolean> {
	const email = normalizeBetaEmail(emailValue), now = new Date().toISOString();
	await assertSignupAccessAllowed(env, googleSub, email);
	await env.DB.batch([
		env.DB.prepare(`WITH identity(google_sub,email,owner_override) AS (VALUES(?,?,?))
			INSERT INTO beta_access(email,status,created_at,updated_at)
			SELECT identity.email,'APPROVED',?,? FROM identity
			WHERE (${signupProofOrLegacySql}) AND NOT (${signupAccessBlockedSql})
			ON CONFLICT(email) DO NOTHING`).bind(googleSub, email, isBetaAdmin(env, email) ? 1 : 0, now, now),
		env.DB.prepare(`WITH identity(google_sub,email,owner_override) AS (VALUES(?,?,?))
			UPDATE beta_access_requests SET status='APPROVED',updated_at=?
			WHERE status='PENDING' AND google_sub=? AND email=?
			AND EXISTS(SELECT 1 FROM identity WHERE (${signupProofOrLegacySql}) AND NOT (${signupAccessBlockedSql}))
			AND EXISTS(SELECT 1 FROM beta_access WHERE email=? AND status='APPROVED')`)
			.bind(googleSub, email, isBetaAdmin(env, email) ? 1 : 0, now, googleSub, email, email),
	]);
	await assertSignupAccessAllowed(env, googleSub, email);
	return hasBetaAccess(env, email);
}
