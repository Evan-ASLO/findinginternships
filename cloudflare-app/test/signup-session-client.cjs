const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), vm = require("node:vm");
const source = fs.readFileSync(path.join(__dirname, "..", "public", "signup-verification.js"), "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));
async function fixture(overrides = {}, confirmation = { emailVerified: true, fullSessionCreated: true, redirectTo: "/#home" }) {
	const nodes = new Map(), calls = [], navigations = [], scrubbed = [];
	const node = (id) => {
		if (!nodes.has(id)) nodes.set(id, { id, hidden: true, textContent: "", disabled: false, listeners: {},
			addEventListener(kind, fn) { this.listeners[kind] = fn; }, focus() {} });
		return nodes.get(id);
	};
	const status = { email: "fictional@example.test", verified: false, expired: false, replaced: false, restricted: false,
		delivery: "ACCEPTED", csrfCookieName: "cc_signup_csrf", loginUrl: "/auth/google/login", ...overrides };
	const context = { URL, URLSearchParams, AbortController, setTimeout, clearTimeout,
		location: { hash: "#t=" + "a".repeat(43), search: "", pathname: "/signup/verify", origin: "https://findinginternships.com",
			assign: (value) => navigations.push(value) },
		history: { replaceState: (_a, _b, value) => scrubbed.push(value) },
		document: { cookie: "cc_signup_csrf=fictional-csrf", body: { dataset: { signupView: "verify" } },
			getElementById: node, querySelectorAll: () => [node("signup-proof-confirm"), node("signup-proof-resend"), node("signup-proof-refresh")] },
		fetch: async (url, init) => { calls.push({ url, init }); return { ok: true, json: async () => init.method === "POST" ? confirmation : status }; },
	};
	vm.runInNewContext(source, context); await tick(); await tick();
	return { nodes, calls, navigations, scrubbed, node };
}
test("only explicit confirmation navigates after a confirmed standard session response", async () => {
	const f = await fixture();
	assert.equal(f.calls.filter((c) => c.init.method === "POST").length, 0);
	assert.deepEqual(f.navigations, []); assert.deepEqual(f.scrubbed, ["/signup/verify"]);
	await f.node("signup-proof-confirm").listeners.click(); await tick();
	assert.equal(f.calls.filter((c) => c.init.method === "POST").length, 1);
	assert.deepEqual(f.navigations, ["/#home"]);
	assert.equal(f.node("signup-proof-state").textContent, "Your email is confirmed. Opening your workspace…");
});
for (const [name, result] of [
	["foreign host", { emailVerified: true, fullSessionCreated: true, redirectTo: "https://untrusted.example/" }],
	["protocol-relative host", { emailVerified: true, fullSessionCreated: true, redirectTo: "//untrusted.example/" }],
	["missing session", { emailVerified: true, fullSessionCreated: false, redirectTo: "/" }],
]) test(`confirmation rejects ${name} response instead of navigating or claiming success`, async () => {
	const f = await fixture({}, result);
	await f.node("signup-proof-confirm").listeners.click(); await tick();
	assert.deepEqual(f.navigations, []);
	assert.match(f.node("signup-proof-error").textContent, /Workspace entry could not be confirmed/);
});
test("already-verified status refresh offers Google recovery but never posts or navigates", async () => {
	const f = await fixture({ verified: true });
	await f.node("signup-proof-refresh").listeners.click(); await tick();
	assert.equal(f.node("signup-proof-confirm").hidden, true);
	assert.equal(f.node("signup-proof-login").hidden, false);
	assert.equal(f.calls.some((c) => c.init.method === "POST"), false);
	assert.deepEqual(f.navigations, []);
	assert.match(f.node("signup-proof-state").textContent, /no owner approval is needed/);
});
test("restricted status suppresses confirmation/resend instead of offering self-approval", async () => {
	const f = await fixture({ restricted: true });
	assert.equal(f.node("signup-proof-confirm").hidden, true);
	assert.equal(f.node("signup-proof-resend").hidden, true);
	assert.deepEqual(f.navigations, []);
	assert.match(f.node("signup-proof-state").textContent, /Contact the site owner/);
});
