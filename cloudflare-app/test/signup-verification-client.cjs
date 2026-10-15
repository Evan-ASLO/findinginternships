const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, ".."), read = (file) => fs.readFileSync(path.join(root, file), "utf8");
test("verification page is standalone self-hosted UI, never the authenticated app or a tracker", () => {
	const page = read("src/lib/signup-verification-page.ts");
	assert.match(page, /noindex,nofollow/); assert.match(page, /no-referrer/);
	assert.match(page, /signup-verification\.js/); assert.doesNotMatch(page, /src="\/app\.js|owner-loader|onboarding\.js|https:\/\//);
	assert.match(page, /Existing users do not need this additional verification/);
	assert.match(page, /original signup browser to finish signup and open your workspace/);
	assert.match(page, /No owner approval is needed for ordinary verified signup/);
	assert.match(read("public/signup-verification.css"), /var\(--cp-/);
});
test("email-link proof is scrubbed and memory-only; confirmation is exclusively explicit click/POST", () => {
	const client = read("public/signup-verification.js");
	assert.match(client, /location\.hash/); assert.match(client, /history\.replaceState/);
	assert.doesNotMatch(client, /localStorage|sessionStorage|console\.|innerHTML/);
	assert.match(client, /addEventListener\("click", \(\) => action\("confirm"\)\)/);
	assert.match(client, /kind === "confirm" \? \{ token \} : \{\}/);
	assert.match(client, /confirmed\) byId\("login"\)\.focus/);
	assert.match(client, /credentials: "same-origin"/);
	assert.match(client, /result\.fullSessionCreated !== true/);
	assert.match(client, /destination\.origin !== location\.origin/);
	assert.match(client, /location\.assign/);
	assert.match(client, /current\?\.restricted/);
});
test("additive policy schema stores hashes, immutable activation intent and deletion protections", () => {
	const schema = read("migrations/0013_signup_email_verification.sql"), server = read("src/lib/signup-verification.ts");
	assert.doesNotMatch(schema, /\bDROP\b|\bALTER TABLE\b|raw_token|plaintext/i);
	for (const text of ["browser_hash", "csrf_hash", "link_hash", "consumed_at", "signup_verification_legacy_users", "signup_verification_user_soft_deleted"]) assert.ok(schema.includes(text));
	assert.match(server, /activated_at IS NULL/); assert.match(server, /verified_at IS NULL/);
	assert.match(read("src/lib/auth.ts"), /fullSessionCreated: true/);
	assert.match(read("src/lib/signup-access.ts"), /ON CONFLICT\(email\) DO NOTHING/);
	assert.doesNotMatch(read("src/lib/signup-access.ts"), /acceptanceNotificationInsert/);
	assert.match(server, /from: "Finding Internships <noreply@findinginternships\.com>"/);
});
test("source config requires preserving installed runtime flag/secret; policy adds no schema or config and keeps canonical target", () => {
	const config = JSON.parse(read("wrangler.jsonc").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
	assert.equal(config.vars.APP_ORIGIN, "https://findinginternships.com");
	assert.equal(config.workers_dev, true);
	assert.ok(config.assets.run_worker_first.includes("/signup/*"));
	assert.equal(config.vars.ENABLE_SIGNUP_EMAIL_VERIFICATION, undefined);
	assert.equal(config.vars.RESEND_API_KEY, undefined);
	assert.match(read("public/privacy.html"), /Resend receives only the/);
	assert.match(read("public/index.html"), /app\.js\?v=20261015-self-service-1/);
	assert.match(read("public/owner-admin.js"), /Automatic verified signup does not queue an acceptance email/);
});
