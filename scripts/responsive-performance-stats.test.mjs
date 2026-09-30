import { expect, test } from "vitest";
import { summarize, labVitals } from "./responsive-performance-stats.mjs";

test("summary uses average middle values and nearest-rank p95, retaining empty samples", () => {
  expect(summarize([40, 10, 30, 20])).toEqual({ n: 4, median: 25, p95: 40, min: 10, max: 40 });
  expect(summarize([])).toEqual({ n: 0, median: null, p95: null, min: null, max: null });
});
test("CLS uses maximum session window and INP uses worst observed interaction for short lab rounds", () => {
  const result = labVitals({ shifts: [{ start: 100, value: .1 }, { start: 800, value: .2 }, { start: 2500, value: .25 }], events: [{ id: 1, duration: 24 }, { id: 1, duration: 32 }, { id: 2, duration: 16 }] });
  expect(result.cls).toBeCloseTo(.3, 10);
  expect(result.inp).toBe(32);
  expect(result.interactionsRecorded).toBe(2);
});
test("no event over reporting threshold remains censored, never invented as zero INP", () => {
  expect(labVitals({ shifts: [], events: [] })).toEqual({ cls: 0, inp: null, interactionsRecorded: 0, inpCensoring: "<16ms; actual interaction observed" });
});
test("CLS starts at the first shift and resets at exact one-second gaps", () => {
  expect(labVitals({ shifts: [{ start: 100, value: .2 }, { start: 1100, value: .3 }], events: [] }).cls).toBe(.3);
  const shifts = [100, 1000, 1900, 2800, 3700, 4600, 5050].map(start => ({ start, value: .1 }));
  expect(labVitals({ shifts, events: [] }).cls).toBeCloseTo(.7, 10);
});
test("CLS resets when the window reaches exactly five seconds", () => {
  const shifts = [100, 1000, 1900, 2800, 3700, 4600, 5100].map(start => ({ start, value: .1 }));
  expect(labVitals({ shifts, events: [] }).cls).toBeCloseTo(.6, 10);
});
