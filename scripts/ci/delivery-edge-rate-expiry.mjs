import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';

const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
function instant(value) {
  assert.equal(typeof value, 'string');
  const at = Date.parse(value); assert.ok(Number.isFinite(at) && new Date(at).toISOString() === value); return at;
}
// Global IP buckets can be shared with unknown callers. Never infer ownership
// from a table diff or restore/delete them. For each complete request observation
// pair, wait for every changed period's real DB expiry, including its preimage.
// Unchanged foreign periods, later traffic and passive rate history remain intact.
export function createRatePeriodLedger() {return {snapshots: [], periods: new Map(), lastObservedAt: null};}
export function recordRatePeriods(ledger, snapshot) {
  const observed = instant(snapshot.observedAt);
  assert.ok(ledger.lastObservedAt === null || instant(ledger.lastObservedAt) <= observed);
  assert.ok(Array.isArray(snapshot.rows) && snapshot.rows.length <= 20000);
  assert.equal(new Set(snapshot.rows.map(row => row.key)).size, snapshot.rows.length);
  const rows = snapshot.rows.map(row => {
    assert.ok(typeof row.key === 'string' && row.key.length > 0 && row.key.length <= 512);
    assert.ok(typeof row.scope === 'string' && /^[a-zA-Z0-9:_-]{1,128}$/.test(row.scope)
      && Number.isSafeInteger(row.count) && row.count >= 0);
    instant(row.updatedAt); instant(row.expiresAt);
    return {keySha256: hash(row.key), scope: row.scope, count: row.count,
      expiresAt: row.expiresAt, updatedAt: row.updatedAt};
  });
  if (ledger.snapshots.length % 2 === 1) {
    const before = new Map(ledger.snapshots.at(-1).rows.map(row => [row.keySha256, row]));
    const after = new Map(rows.map(row => [row.keySha256, row]));
    for (const key of new Set([...before.keys(), ...after.keys()])) {
      if (JSON.stringify(before.get(key)) === JSON.stringify(after.get(key))) continue;
      for (const row of [before.get(key), after.get(key)].filter(Boolean)) {
        if (instant(row.expiresAt) >= observed) ledger.periods.set(hash([key, row.expiresAt]),
          {keySha256: key, expiresAt: row.expiresAt});
      }
    }
  }
  ledger.snapshots.push({observedAt: snapshot.observedAt, rows, sha256: hash(rows)});
  ledger.lastObservedAt = snapshot.observedAt;
}
export function verifyRateExpiry(ledger, databaseNow, requestsSettled) {
  assert.equal(requestsSettled, true, 'EDGE_USAGE_REQUEST_OUTCOME_UNKNOWN');
  assert.ok(ledger.snapshots.length > 0, 'EDGE_USAGE_RATE_EVIDENCE_MISSING');
  assert.equal(ledger.snapshots.length % 2, 0, 'EDGE_USAGE_RATE_EVIDENCE_INCOMPLETE');
  const now = instant(databaseNow); assert.ok(instant(ledger.lastObservedAt) <= now);
  const periods = [...ledger.periods.values()];
  assert.ok(periods.every(period => instant(period.expiresAt) <= now), 'EDGE_USAGE_RATE_PERIOD_ACTIVE');
  return {databaseObservedAt: databaseNow, activeSyntheticRateEffectRemaining: 0,
    retainedObservedPeriods: periods.length, retainedRatePeriods: periods,
    snapshots: ledger.snapshots, sharedRowsDeleted: 0, zeroRowsClaimed: false};
}
