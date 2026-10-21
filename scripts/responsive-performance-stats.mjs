export function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  return { n, median: n ? (sorted[Math.floor((n - 1) / 2)] + sorted[Math.ceil((n - 1) / 2)]) / 2 : null, p95: n ? sorted[Math.ceil(n * .95) - 1] : null, min: n ? sorted[0] : null, max: n ? sorted[n - 1] : null };
}

// These rounds contain fewer than 50 interactions, so INP is the maximum.
// Only unexpected shifts enter this function (hadRecentInput filtered by observer).
export function labVitals({ shifts, events }) {
  let start = null, previous = null, total = 0, cls = 0;
  for (const shift of shifts) {
    if (start === null || shift.start - previous >= 1000 || shift.start - start >= 5000) { start = shift.start; total = 0; }
    total += shift.value;
    cls = Math.max(cls, total);
    previous = shift.start;
  }
  const inp = events.length ? Math.max(...events.map(event => event.duration)) : null;
  return { cls, inp, interactionsRecorded: new Set(events.map(event => event.id)).size, inpCensoring: inp === null ? "<16ms; actual interaction observed" : null };
}
