import assert from "node:assert/strict";
import test from "node:test";
import { activeStage, concepts, demoReducer, initialDemo, progressAt } from "../lib/tour-data.mjs";
const stops = [100, 500, 1100, 1700, 2500];
test("five endpoints reflect four equal tour quarters, including unequal chapter heights", () => {
  stops.forEach((value, index) => assert.equal(progressAt(value, stops), index / 4));
  assert.equal(progressAt(300, stops), .125);
  assert.equal(progressAt(800, stops), .375);
  assert.equal(progressAt(1400, stops), .625);
  assert.equal(progressAt(2100, stops), .875);
  assert.equal(progressAt(-100, stops), 0);
  assert.equal(progressAt(3000, stops), 1);
  assert.equal(progressAt(499.6, stops), .25);
  assert.equal(activeStage(progressAt(499.6, stops)), 1);
});
test("backward scrolling reverses progress and stage, without completing tool actions", () => {
  const values = [...stops].reverse().map((value) => progressAt(value, stops));
  assert.deepEqual(values, [1, .75, .5, .25, 0]);
  assert.deepEqual(values.map(activeStage), [3, 3, 2, 1, 0]);
  assert.deepEqual(initialDemo, { searched: false, query: "policy", saved: false, stage: "SAVED", notes: "Compare programme requirements, then tailor my application.", prepared: false, reviewed: false, attachment: false, sent: false, outcome: "APPLIED", outcomeRecorded: false });
});
test("invalid progress geometry fails explicitly", () => {
  for (const invalid of [[], [0, 1, 1, 3, 4], [4, 3, 2, 1, 0], [0, 1, 2, 3, NaN]]) assert.throws(() => progressAt(1, invalid));
});
test("preparation and actual draft approval are separate; attachment alone never authorizes send", () => {
  let state = { ...initialDemo };
  state = demoReducer(state, { type: "review" }); assert.equal(state.reviewed, false);
  state = demoReducer(state, { type: "attachment" }); state = demoReducer(state, { type: "send" }); assert.equal(state.sent, false);
  state = demoReducer(state, { type: "prepare" }); state = demoReducer(state, { type: "send" }); assert.equal(state.sent, false);
  state = demoReducer(state, { type: "review" }); state = demoReducer(state, { type: "send" }); assert.equal(state.sent, true);
  assert.equal(state.stage, "SAVED"); assert.equal(state.outcomeRecorded, false);
});
test("outcomes are manually recorded and sample state remains local/resettable", () => {
  let a = demoReducer(initialDemo, { type: "save" }), b = { ...initialDemo };
  a = demoReducer(a, { type: "notes", value: "Sample note" });
  a = demoReducer(a, { type: "outcome", value: "OFFER" }); assert.equal(a.outcomeRecorded, false);
  a = demoReducer(a, { type: "record" }); assert.equal(a.outcomeRecorded, true);
  assert.equal(b.saved, false); assert.equal(b.notes, initialDemo.notes);
  assert.deepEqual(demoReducer(a, { type: "reset" }), initialDemo);
});
test("three distinct user-pinned compositions have durable five-part direction contracts", () => {
  assert.deepEqual(Object.keys(concepts), ["workspace", "chapters", "map"]);
  for (const concept of Object.values(concepts)) for (const part of ["THESIS:", "OWN-WORLD:", "STORY:", "FIRST VIEWPORT:", "FORM:"]) assert.ok(concept.contract.includes(part));
});
