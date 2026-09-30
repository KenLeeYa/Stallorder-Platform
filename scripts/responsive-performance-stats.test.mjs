import test from "node:test";
import assert from "node:assert/strict";
import { summarize, labVitals } from "./responsive-performance-stats.mjs";

test("summary uses average middle values and nearest-rank p95, retaining empty samples", () => {
  assert.deepEqual(summarize([40, 10, 30, 20]), { n: 4, median: 25, p95: 40, min: 10, max: 40 });
  assert.deepEqual(summarize([]), { n: 0, median: null, p95: null, min: null, max: null });
});
test("CLS uses maximum session window and INP uses worst observed interaction for short lab rounds", () => {
  const result = labVitals({ shifts: [{ start: 100, value: .1 }, { start: 800, value: .2 }, { start: 2500, value: .25 }], events: [{ id: 1, duration: 24 }, { id: 1, duration: 32 }, { id: 2, duration: 16 }] });
  assert.ok(Math.abs(result.cls - .3) < 1e-10);
  assert.equal(result.inp, 32);
  assert.equal(result.interactionsRecorded, 2);
});
test("no event over reporting threshold remains censored, never invented as zero INP", () => {
  assert.deepEqual(labVitals({ shifts: [], events: [] }), { cls: 0, inp: null, interactionsRecorded: 0, inpCensoring: "<16ms; actual interaction observed" });
});
test("CLS starts at the first shift and resets at exact one-second gaps", () => {
  assert.equal(labVitals({ shifts: [{ start: 100, value: .2 }, { start: 1100, value: .3 }], events: [] }).cls, .3);
  const shifts = [100, 1000, 1900, 2800, 3700, 4600, 5050].map(start => ({ start, value: .1 }));
  assert.ok(Math.abs(labVitals({ shifts, events: [] }).cls - .7) < 1e-10);
});
