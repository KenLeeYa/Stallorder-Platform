import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRatePeriodLedger, recordRatePeriods, verifyRateExpiry} from './delivery-edge-rate-expiry.mjs';

const at = '2026-11-05T08:00:00.000Z';
const row = (key, end) => ({key, scope: 'legacy', count: 1, expiresAt: end, updatedAt: at});
test('retains observed shared periods without claiming or deleting their rows', () => {
  const ledger = createRatePeriodLedger();
  recordRatePeriods(ledger, {observedAt: at, rows: [row('a', '2026-11-05T08:07:00.000Z')]});
  recordRatePeriods(ledger, {observedAt: '2026-11-05T08:01:00.000Z', rows: [row('b', '2026-11-05T08:06:00.000Z')]});
  assert.throws(() => verifyRateExpiry(ledger, '2026-11-05T08:06:59.999Z', true));
  const out = verifyRateExpiry(ledger, '2026-11-05T08:07:00.000Z', true);
  assert.equal(out.activeSyntheticRateEffectRemaining, 0);
  assert.equal(out.retainedObservedPeriods, 2);
  assert.equal(out.sharedRowsDeleted, 0);
  assert.equal(out.zeroRowsClaimed, false);
});
test('cannot replace original expiry by last request plus five minutes or a later period', () => {
  const ledger = createRatePeriodLedger();
  recordRatePeriods(ledger, {observedAt: at, rows: [row('a', '2026-11-05T09:00:00.000Z')]});
  recordRatePeriods(ledger, {observedAt: '2026-11-05T08:01:00.000Z', rows: [row('a', '2026-11-05T09:01:00.000Z')]});
  assert.throws(() => verifyRateExpiry(ledger, '2026-11-05T08:06:00.000Z', true));
  assert.throws(() => verifyRateExpiry(ledger, '2026-11-05T09:00:00.000Z', true));
});
test('unknown outstanding request never becomes clean just by waiting', () => {
  const ledger = createRatePeriodLedger(); recordRatePeriods(ledger, {observedAt: at, rows: []});
  assert.throws(() => verifyRateExpiry(ledger, '2026-11-05T09:00:00.000Z', false));
});
test('rejects duplicate, unbounded, malformed or retrograde database observations', () => {
  for (const bad of [{observedAt: at, rows: [row('a', at), row('a', at)]},
    {observedAt: at, rows: [{...row('a', at), expiresAt: 'invalid'}]},
    {observedAt: at, rows: Array.from({length: 20001}, (_, i) => row(String(i), at))}]) {
    assert.throws(() => recordRatePeriods(createRatePeriodLedger(), bad));
  }
  const ledger = createRatePeriodLedger(); recordRatePeriods(ledger, {observedAt: at, rows: []});
  assert.throws(() => recordRatePeriods(ledger, {observedAt: '2026-11-05T07:59:59.999Z', rows: []}));
});
test('requires a complete before and after observation pair', () => {
  const ledger=createRatePeriodLedger(); recordRatePeriods(ledger,{observedAt:at,rows:[]});
  assert.throws(()=>verifyRateExpiry(ledger,'2026-11-05T09:00:00.000Z',true),/EDGE_USAGE_RATE_EVIDENCE_INCOMPLETE/);
});
test('unchanged foreign periods do not extend the wait for observed request changes', () => {
  const ledger=createRatePeriodLedger();
  const foreign=row('foreign-private-key','2026-11-05T08:15:00.000Z');
  recordRatePeriods(ledger,{observedAt:at,rows:[foreign]});
  recordRatePeriods(ledger,{observedAt:'2026-11-05T08:00:01.000Z',rows:[foreign,row('changed','2026-11-05T08:05:00.000Z')]});
  const out=verifyRateExpiry(ledger,'2026-11-05T08:05:00.000Z',true);
  assert.equal(out.retainedObservedPeriods,1);
  assert.ok(Array.isArray(out.snapshots[0].rows));
  assert.equal(out.snapshots[0].sha256,createHash('sha256').update(JSON.stringify(out.snapshots[0].rows)).digest('hex'));
  assert.equal(out.snapshots[0].rows[0].scope,'legacy');
  assert.equal(out.snapshots[0].rows[0].count,1);
  assert.equal(out.snapshots[0].rows[0].expiresAt,foreign.expiresAt);
  assert.ok(!JSON.stringify(out).includes('foreign-private-key'));
  foreign.count=99;
  assert.equal(out.snapshots[0].rows[0].count,1);
});
