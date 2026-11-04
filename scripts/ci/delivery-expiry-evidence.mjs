import assert from 'node:assert/strict';

const instant = value => {
  const text = value instanceof Date ? value.toISOString() : value;
  assert.equal(typeof text, 'string');
  assert.match(text, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  const at = Date.parse(text);
  assert.equal(new Date(at).toISOString(), text);
  return at;
};

const schedulerInstant = value => {
  assert.equal(typeof value, 'string');
  const match = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2})\.(\d{6})Z$/.exec(value);
  assert.ok(match, 'raw UTC microsecond timestamp required');
  const second = instant(`${match[1]}.000Z`);
  const fraction = Number(match[2]);
  return { microseconds: BigInt(second) * 1000n + BigInt(fraction),
    rounded: second + Math.round(fraction / 1000) };
};

// A local evidence comparator, not an authenticated Production scheduler receipt.
// The caller must observe the unchanged order while waiting, without invoking
// expiry itself, and collect cron.job_run_details from its owned database.
export function verifyNaturalExpiry({ before, after, job, execution, startedAt, observedAt, eventCount, confirmedStatus }) {
  assert.ok(before && after && job && execution);
  assert.equal(before.status, 'WAITING_CONFIRMATION'); assert.equal(after.status, 'EXPIRED');
  assert.ok(typeof before.id === 'string' && before.id.trim().length > 0, 'order identity required');
  assert.equal(after.id, before.id);
  const created = instant(before.createdAt), deadline = instant(before.confirmationExpiresAt);
  const expired = instant(after.expiredAt), observed = instant(observedAt);
  assert.equal(deadline - created, 600_000, 'original confirmation window is not 600 seconds');
  assert.equal(instant(after.createdAt), created, 'created time changed');
  assert.equal(instant(after.confirmationExpiresAt), deadline, 'deadline changed');
  assert.ok(instant(startedAt) >= created && instant(startedAt) < deadline);
  assert.ok(expired >= deadline && expired - deadline <= 120_000, 'early or delayed expiry');
  assert.ok(observed >= expired && observed - deadline <= 180_000);
  assert.equal(eventCount, 1); assert.equal(confirmedStatus, 'CONFIRMED');
  assert.ok(Number.isSafeInteger(job.jobid) && job.jobid > 0);
  assert.equal(job.jobname, 'stallorder-expire-unconfirmed-orders');
  assert.equal(job.schedule, '* * * * *');
  assert.equal(job.command, 'select public.expire_unconfirmed_orders()');
  assert.equal(job.database, 'postgres'); assert.equal(job.username, 'postgres'); assert.equal(job.active, true);
  assert.equal(execution.jobid, job.jobid); assert.equal(execution.status, 'succeeded');
  assert.ok(Number.isSafeInteger(execution.runid) && execution.runid > 0, 'scheduler run identity required');
  assert.equal(execution.command, job.command); assert.equal(execution.database, job.database);
  assert.equal(execution.username, job.username);
  const start = schedulerInstant(execution.start_time_raw), end = schedulerInstant(execution.end_time_raw);
  assert.ok(start.microseconds <= end.microseconds && end.microseconds <= BigInt(observed) * 1000n,
    'invalid raw scheduler execution interval');
  assert.equal(instant(execution.start_time), start.rounded, 'scheduler start precision mismatch');
  assert.equal(instant(execution.end_time), end.rounded, 'scheduler end precision mismatch');
  assert.ok(instant(execution.start_time) <= expired && instant(execution.end_time) >= expired
    && instant(execution.end_time) <= observed, 'scheduler execution does not contain the expiry');
  return { elapsedFromCreationMs: observed - created, confirmationWindowMs: deadline - created,
    expiryDelayMs: expired - deadline, realCronTimingVerified: true, productionSchedulerVerified: false };
}
