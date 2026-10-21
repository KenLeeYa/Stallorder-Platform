import { expect, test, vi } from 'vitest';
import { boundedFixtureStep, createCaseRunner, sanitizedCaseFailure } from './qa-pr366-preview-ui.mjs';

test.each(['session-cookies', 'request-1-GET', 'request-2-GET-body', 'request-3-POST'])('a stalled %s fails and persists the case without retrying', async stage => {
  vi.useFakeTimers();
  try {
    const steps = []; const progress = []; const results = [];
    const operation = vi.fn(() => new Promise(() => {}));
    const check = createCaseRunner(results, row => progress.push(structuredClone(row)));
    const pending = check('dense-expense-mobile-more-collapse-full-desktop-summary', () =>
      boundedFixtureStep(stage, operation, row => steps.push(row)));
    const failure = expect(pending).rejects.toThrow('PREVIEW_UI_CASE_FAILED');
    await vi.advanceTimersByTimeAsync(30_000);
    await failure;
    expect(operation).toHaveBeenCalledTimes(1);
    expect(steps).toEqual([{ stage, state: 'RUNNING' }, { stage, state: 'FAIL', code: 'PREVIEW_FIXTURE_STEP_TIMEOUT' }]);
    expect(progress.at(-1).state).toBe('FAIL');
    expect(results[0].failure.code).toBe('PREVIEW_FIXTURE_STEP_TIMEOUT');
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('successful response is preserved and pending timers are cleared', async () => {
  vi.useFakeTimers();
  try {
    const response = { status: () => 200 }; const steps = [];
    expect(await boundedFixtureStep('request-2-GET', async () => response, row => steps.push(row))).toBe(response);
    expect(steps.at(-1)).toEqual({ stage: 'request-2-GET', state: 'PASS' });
    expect(vi.getTimerCount()).toBe(0);
  } finally { vi.useRealTimers(); }
});

test('failure evidence omits provider messages, request data, URLs and credentials', async () => {
  const steps = [];
  const error = Error('private token and provider response');
  await expect(boundedFixtureStep('request-3-POST', async () => { throw error; }, row => steps.push(row))).rejects.toBe(error);
  expect(JSON.stringify(steps)).not.toContain(error.message);
  expect(sanitizedCaseFailure(error, 'expense').code).toBe('PREVIEW_UI_OPERATION_FAILED');
});

test('later case progress retains each completed case timing, including failures', async () => {
  const results = []; const progress = []; let clock = 100;
  const check = createCaseRunner(results, row => progress.push(structuredClone(row)), () => clock);
  await check('first', async () => { clock += 30; });
  await expect(check('second', async () => { clock += 50; throw Error('private'); })).rejects.toThrow('PREVIEW_UI_CASE_FAILED');
  expect(progress.at(-1).results.map(({ name, startedAt, endedAt, elapsedMs }) => ({ name, startedAt, endedAt, elapsedMs })))
    .toEqual([{ name: 'first', startedAt: 100, endedAt: 130, elapsedMs: 30 }, { name: 'second', startedAt: 130, endedAt: 180, elapsedMs: 50 }]);
});
