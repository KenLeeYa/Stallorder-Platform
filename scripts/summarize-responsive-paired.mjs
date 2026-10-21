import assert from "node:assert/strict";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { summarize } from "./responsive-performance-stats.mjs";

const directory = "artifacts/ux-responsive-20260930/b3-performance";
const read = name => JSON.parse(readFileSync(`${directory}/${name}.json`, "utf8"));
const sha = name => createHash("sha256").update(readFileSync(`${directory}/${name}.json`)).digest("hex");
const write = (name, value) => writeFileSync(`${directory}/${name}.json`, JSON.stringify(value, null, 2) + "\n");
function series(data) {
  assert.equal(data.status, "MEASURED");
  const result = {};
  for (const [route, detail] of Object.entries(data.routes)) {
    for (const cache of ["cold", "warm"]) result[`${route}/${cache}`] = detail[cache];
    assert.equal(data.vitals[route].length, 5);
    for (const round of data.vitals[route]) {
      assert(Number.isFinite(round.lcp) && Number.isFinite(round.cls));
      assert(round.inp === null || Number.isFinite(round.inp));
    }
  }
  for (const [name, detail] of Object.entries(data.api)) result[`API/${name}`] = detail;
  assert.equal(Object.keys(result).length, 11);
  for (const detail of Object.values(result)) assert.equal(detail.samples.length, 30);
  assert.equal(data.freeze.length, 2);
  assert.equal(data.freeze[0].fullDatasetDigest, data.freeze[1].fullDatasetDigest);
  return result;
}
const before = read("before-full"), baseline = series(before);
if (process.argv[2] === "goals") {
  assert(!existsSync(`${directory}/after-full.json`), "Goals must precede candidate measurement");
  assert(!existsSync(`${directory}/goals.json`), "Do not overwrite the preregistered goals");
  const goals = { createdAt: new Date().toISOString(), beforeSha256: sha("before-full"), method: "Exploratory goal: reduce median by at least the baseline interquartile range (nearest-rank Q3 minus Q1), without a higher p95 or invalid-attempt rate. The IQR describes observed spread, not a confidence interval; meeting this goal alone does not establish causality or statistical significance. Zero IQR permits only a strictly lower median to count as improvement.", series: {}, bundle: read("before-bundles").routes.map(r => ({ route: r.route, maximumEntryBytes: r.totalBytes })), maximumSharedBytes: read("before-bundles").sharedBytes };
  for (const [key, detail] of Object.entries(baseline)) {
    const sorted = [...detail.samples].sort((a, b) => a - b), stats = summarize(sorted);
    const iqr = sorted[Math.ceil(sorted.length * .75) - 1] - sorted[Math.ceil(sorted.length * .25) - 1];
    goals.series[key] = { baseline: stats, baselineIqr: iqr, medianTarget: Math.max(0, stats.median - iqr), maximumP95: stats.p95, maximumInvalidRate: detail.errorRate };
  }
  write("goals", goals);
} else if (process.argv[2] === "compare") {
  const after = read("after-full"), candidate = series(after), goals = read("goals");
  assert.equal(goals.beforeSha256, sha("before-full"));
  assert(new Date(goals.createdAt) < new Date(after.startedAt));
  for (const key of ["measurementSha256", "statisticsSha256"]) assert.equal(before[key], after[key]);
  assert.deepEqual(before.environment, after.environment);
  assert.deepEqual(before.semantics, after.semantics);
  for (const key of ["fullDatasetDigest", "orderDigest", "runtimeContractSha256"]) assert.equal(before.freeze[0][key], after.freeze[1][key]);
  const comparison = { createdAt: new Date().toISOString(), beforeSha256: sha("before-full"), afterSha256: sha("after-full"), goalsSha256: sha("goals"), series: {}, vitals: {}, bundle: [] };
  for (const [key, detail] of Object.entries(candidate)) {
    const b = summarize(baseline[key].samples), a = summarize(detail.samples), goal = goals.series[key];
    comparison.series[key] = { before: b, after: a, medianDelta: a.median - b.median, p95Delta: a.p95 - b.p95, beforeInvalid: baseline[key].attempts.length - 30, afterInvalid: detail.attempts.length - 30, goalMet: a.median < b.median && a.median <= goal.medianTarget && a.p95 <= goal.maximumP95 && detail.errorRate <= goal.maximumInvalidRate };
  }
  for (const route of Object.keys(before.vitals)) {
    comparison.vitals[route] = {};
    for (const [phase, data] of [["before", before], ["after", after]]) {
      const records = data.vitals[route];
      comparison.vitals[route][phase] = { lcp: summarize(records.map(r => r.lcp)), cls: summarize(records.map(r => r.cls)), inp: records.every(r => r.inp !== null) ? summarize(records.map(r => r.inp)) : { censored: true, raw: records.map(r => r.inp ?? "<16ms"), explanation: "No uncensored summary substituted for the five-round distribution" } };
    }
  }
  const beforeBundle = read("before-bundles"), afterBundle = read("after-bundles");
  for (const [bundle, data] of [[beforeBundle, before], [afterBundle, after]]) {
    for (const key of ["head", "tree", "buildId"]) assert.equal(bundle.source[key], data.source[key]);
  }
  for (const b of beforeBundle.routes) {
    const a = afterBundle.routes.find(r => r.route === b.route);
    comparison.bundle.push({ route: b.route, beforeBytes: b.totalBytes, afterBytes: a.totalBytes, delta: a.totalBytes - b.totalBytes, goalMet: a.totalBytes <= b.totalBytes });
  }
  comparison.sharedBundle = { beforeBytes: beforeBundle.sharedBytes, afterBytes: afterBundle.sharedBytes, delta: afterBundle.sharedBytes - beforeBundle.sharedBytes };
  write("comparison", comparison);
} else throw Error("Expected goals or compare");
