const test = require("node:test"), assert = require("node:assert/strict");
const fs = require("node:fs"), path = require("node:path"), crypto = require("node:crypto");
const root = path.join(__dirname, ".."), read = (name) => fs.readFileSync(path.join(root, name), "utf8");
test("supplied brand image remains exact512px source, with explicit square icon dimensions", () => {
	const source = fs.readFileSync(path.join(root, "public/brand/finding-internships.png"));
	assert.equal(crypto.createHash("sha256").update(source).digest("hex"), "1b25e7e159c01af8398b88a48fbd126742e6bbca24b419330bf9f123942af059");
	for (const size of [16, 32, 180, 192, 512]) {
		const bytes = size === 512 ? source : fs.readFileSync(path.join(root, `public/brand/finding-internships-${size}.png`));
		assert.equal(bytes.readUInt32BE(16), size); assert.equal(bytes.readUInt32BE(20), size);
	}
});
test("maintained app/signup/legal text and self-hosted metadata use Finding Internships without repeated spoken logos", () => {
	for (const name of ["public/index.html", "public/privacy.html", "public/terms.html", "public/app.js", "public/onboarding.js", "src/lib/signup-verification-page.ts", "src/lib/beta-notifications.ts", "src/lib/google.ts"]) {
		const text = read(name);
		assert.doesNotMatch(text, /Internships? (?:&(?:amp;)?|and) Coffee Chat|Coffee Chat Agent/);
		assert.match(text, /Finding Internships/);
	}
	for (const name of ["public/index.html", "public/privacy.html", "public/terms.html", "src/lib/signup-verification-page.ts"]) {
		const text = read(name);
		assert.match(text, /rel="icon"[^>]*finding-internships-32\.png/);
		assert.match(text, /rel="apple-touch-icon"[^>]*finding-internships-180\.png/);
		assert.match(text, /property="og:image"[^>]*findinginternships\.com\/brand\/finding-internships\.png/);
		assert.match(text, /class="brand-mark brand-image"[^>]*width="40" height="40" alt="" aria-hidden="true"/);
	}
	assert.match(read("public/styles.css"), /brand-mark\.brand-image[^}]*object-fit: contain/);
});
test("branding keeps proof controls, canonical ownership file and deploy defaults", () => {
	const pkg = JSON.parse(read("package.json"));
	assert.equal(pkg.scripts.deploy, "wrangler deploy --keep-vars --no-autoconfig");
	const bytes = fs.readFileSync(path.join(root, "public/google608a0386c4068490.html"));
	assert.equal(bytes.length, 53);
	assert.equal(crypto.createHash("sha256").update(bytes).digest("hex"), "3d692211ec92cf7c98b5fde9d6286ae18264d6b891370a0bdcebd2ccdc5ff2fb");
	const config = JSON.parse(read("wrangler.jsonc").replace(/^\s*\/\*[\s\S]*?\*\/\s*/, ""));
	assert.equal(config.vars.APP_ORIGIN, "https://findinginternships.com");
	assert.equal(config.vars.ENABLE_SIGNUP_EMAIL_VERIFICATION, undefined);
	assert.equal(config.assets.run_worker_first.includes("/brand/*"), false);
});
