import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyNaturalExpiry } from './delivery-expiry-evidence.mjs';

function fixture() {
  return {
    before: { id: 'owned-order', status: 'WAITING_CONFIRMATION',
      createdAt: '2026-11-04T19:00:00.000Z', confirmationExpiresAt: '2026-11-04T19:10:00.000Z' },
    after: { id: 'owned-order', status: 'EXPIRED', createdAt: '2026-11-04T19:00:00.000Z',
      confirmationExpiresAt: '2026-11-04T19:10:00.000Z', expiredAt: '2026-11-04T19:10:01.000Z' },
    job: { jobid: 7, jobname: 'stallorder-expire-unconfirmed-orders', schedule: '* * * * *',
      command: 'select public.expire_unconfirmed_orders()', database: 'postgres', username: 'postgres', active: true },
    execution: { jobid: 7, runid: 23, command: 'select public.expire_unconfirmed_orders()',
      database: 'postgres', username: 'postgres', status: 'succeeded', start_time: '2026-11-04T19:10:00.900Z',
      end_time: '2026-11-04T19:10:01.100Z', start_time_raw: '2026-11-04T19:10:00.900000Z',
      end_time_raw: '2026-11-04T19:10:01.100000Z' },
    startedAt: '2026-11-04T19:00:01.000Z', observedAt: '2026-11-04T19:10:02.000Z',
    eventCount: 1, confirmedStatus: 'CONFIRMED',
  };
}

test('binds the unchanged 600-second order deadline to one successful natural cron execution', () => {
  assert.deepEqual(verifyNaturalExpiry(fixture()), {
    elapsedFromCreationMs: 602000, confirmationWindowMs: 600000, expiryDelayMs: 1000,
    realCronTimingVerified: true, productionSchedulerVerified: false,
  });
});

test('binds PostgreSQL millisecond rounding to preserved microsecond timestamps', () => {
  const input = fixture();
  input.execution.start_time_raw = '2026-11-04T19:10:01.000100Z';
  input.execution.start_time = '2026-11-04T19:10:01.000Z';
  input.execution.end_time_raw = '2026-11-04T19:10:00.999500Z';
  input.execution.end_time = '2026-11-04T19:10:01.000Z';
  // Real execution order is separately enforced: rounding must not hide reversal.
  assert.throws(() => verifyNaturalExpiry(input));
  input.execution.start_time_raw = '2026-11-04T19:10:00.999500Z';
  input.execution.end_time_raw = '2026-11-04T19:10:01.000350Z';
  assert.equal(verifyNaturalExpiry(input).realCronTimingVerified, true);
  input.execution.end_time = '2026-11-04T19:10:01.001Z';
  assert.throws(() => verifyNaturalExpiry(input));
});

test('rejects accelerated or altered deadlines, late observation and wrong order identity', () => {
  for (const mutate of [
    x => { x.before.confirmationExpiresAt = '2026-11-04T19:01:00.000Z'; },
    x => { x.after.confirmationExpiresAt = '2026-11-04T19:09:00.000Z'; },
    x => { x.after.createdAt = '2026-11-04T18:59:00.000Z'; },
    x => { x.after.expiredAt = '2026-11-04T19:09:59.999Z'; },
    x => { x.after.expiredAt = '2026-11-04T19:13:00.000Z'; },
    x => { x.startedAt = '2026-11-04T19:10:00.000Z'; },
    x => { x.observedAt = '2026-11-04T19:10:00.999Z'; },
    x => { x.after.id = 'foreign-order'; },
    x => { delete x.before.id; delete x.after.id; },
    x => { x.before.id = ''; x.after.id = ''; },
    x => { x.before.status = 'EXPIRED'; },
    x => { x.after.status = 'WAITING_CONFIRMATION'; },
    x => { x.eventCount = 2; },
    x => { x.confirmedStatus = 'EXPIRED'; },
  ]) { const input = fixture(); mutate(input); assert.throws(() => verifyNaturalExpiry(input)); }
});

test('rejects absent, foreign, failed or non-overlapping scheduler evidence', () => {
  for (const mutate of [
    x => { x.job = null; }, x => { x.execution = null; },
    x => { x.job.active = false; }, x => { x.job.schedule = '* * * * * *'; },
    x => { x.job.command = 'select unrelated()'; }, x => { x.job.username = 'supabase_admin'; },
    x => { x.job.database = 'other'; }, x => { x.execution.jobid++; },
    x => { delete x.execution.runid; }, x => { x.execution.runid = 0; },
    x => { delete x.execution.command; }, x => { x.execution.command = 'select unrelated()'; },
    x => { delete x.execution.database; }, x => { x.execution.database = 'other'; },
    x => { delete x.execution.username; }, x => { x.execution.username = 'supabase_admin'; },
    x => { delete x.execution.start_time_raw; }, x => { delete x.execution.end_time_raw; },
    x => { x.execution.status = 'failed'; },
    x => { x.execution.start_time = '2026-11-04T19:10:01.001Z'; },
    x => { x.execution.end_time = '2026-11-04T19:10:00.999Z'; },
    x => { x.execution.end_time = '2026-11-04T19:10:03.000Z'; },
  ]) { const input = fixture(); mutate(input); assert.throws(() => verifyNaturalExpiry(input)); }
});
