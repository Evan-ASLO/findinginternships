const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path");
const root = path.join(__dirname, "..");
test("novice-facing npm deployment preserves installed variables and disables autoconfiguration", () => {
	const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
	const args = pkg.scripts.deploy.split(/\s+/);
	assert.deepEqual(args.slice(0, 2), ["wrangler", "deploy"]);
	assert.ok(args.includes("--keep-vars"));
	assert.ok(args.includes("--no-autoconfig"));
	assert.equal(args.includes("--keep-vars=false"), false);
});
test("setup documents the runtime verification control without installing flags or secrets in source", () => {
	const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
	assert.match(readme, /npm run deploy/);
	assert.match(readme, /--keep-vars --no-autoconfig/);
	assert.match(readme, /exactly `true` afterward/);
	const config = JSON.parse(fs.readFileSync(path.join(root, "wrangler.jsonc"), "utf8").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
	assert.equal(config.vars.ENABLE_SIGNUP_EMAIL_VERIFICATION, undefined);
	assert.equal(config.vars.RESEND_API_KEY, undefined);
});
