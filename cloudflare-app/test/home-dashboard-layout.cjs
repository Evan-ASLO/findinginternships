const test = require("node:test"), assert = require("node:assert/strict"), fs = require("node:fs"), path = require("node:path");
const publicRoot = path.join(__dirname, "..", "public");
const styles = fs.readFileSync(path.join(publicRoot, "styles.css"), "utf8"), theme = fs.readFileSync(path.join(publicRoot, "job-first.css"), "utf8");
const app = fs.readFileSync(path.join(publicRoot, "app.js"), "utf8"), index = fs.readFileSync(path.join(publicRoot, "index.html"), "utf8");
function rule(source, selector) {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = new RegExp(`${escaped}\\s*\\{([^}]*)\\}`).exec(source);
	assert.ok(match, `Missing scoped rule: ${selector}`); return match[1];
}
test("recent cards keep metadata content-sized and align only their action group, without fixed heights", () => {
	const card = rule(styles, ".home-recent-card"), chips = rule(styles, ".home-recent-card .chips"), actions = rule(styles, ".home-recent-actions");
	assert.match(card, /display:\s*flex/); assert.match(card, /flex-direction:\s*column/);
	assert.doesNotMatch(card, /(?:^|;)\s*(?:min-|max-)?height:/);
	assert.match(chips, /align-items:\s*flex-start/);
	assert.match(actions, /display:\s*flex/); assert.match(actions, /flex-wrap:\s*wrap/); assert.match(actions, /margin-top:\s*auto/);
	assert.doesNotMatch(actions, /grid-template|height:/);
});
test("posting links and buttons share a specific readable 44px control rule, preventing the old specificity split", () => {
	const actions = rule(styles, ".home-recent-actions > :is(button, .button)");
	assert.match(actions, /min-height:\s*44px/); assert.match(actions, /font-size:\s*0\.875rem/);
	assert.match(actions, /min-width:\s*44px/);
	assert.match(actions, /padding:\s*10px 8px/);
	assert.match(actions, /max-width:\s*100%/); assert.match(actions, /white-space:\s*normal/);
	assert.match(rule(styles, ".home-recent-title > div:last-child"), /overflow-wrap:\s*anywhere/);
	assert.match(rule(styles, ".home-recent-title p"), /var\(--cp-text-soft\)/);
});
test("both panels share header/padding rhythm with Recent roles primary and container-aware stacking", () => {
	assert.match(rule(theme, ".home-reference-lower"), /1\.5fr/);
	assert.match(rule(theme, ".home-recent-panel, .home-journey-panel"), /padding:\s*24px/);
	assert.match(rule(theme, ".home-recent-panel h2, .home-journey-panel h2"), /font-size:\s*1\.375rem/);
	assert.match(theme, /@container \(max-width: 600px\)\s*\{\s*\.home-recent-grid \{ grid-template-columns: minmax\(0, 1fr\);/);
	assert.match(theme, /@media \(max-width: 1100px\)\s*\{\s*\.home-reference-lower \{ grid-template-columns: minmax\(0, 1fr\);/);
	assert.match(theme, /@media \(max-width: 760px\)\s*\{\s*\.home-recent-panel, \.home-journey-panel \{ padding: 20px;/);
});
test("layout-only change retains all role/journey content and actions and bumps both affected CSS assets", () => {
	const start = app.indexOf("function homeRecentJobCard("), end = app.indexOf("\nfunction ", start + 1), card = app.slice(start, end);
	for (const entry of ["View posting", "data-job-save", "Mark applied", "jobContactAction(job)", "JobSourceUi.sourceLabel", "job.postedAt", "job.industry"]) assert.ok(card.includes(entry));
	assert.match(app, /id="journey-reset"/); assert.match(app, /renderHomeJourneyDetail\(snapshot\)/);
	assert.match(index, /styles\.css\?v=20261015-dashboard-layout-1/);
	assert.match(index, /job-first\.css\?v=20261015-dashboard-layout-1/);
});
