import { expect, test, vi } from 'vitest';
import { verifySessionRevocation } from './qa-pr366-preview-ui.mjs';
import { verifySessionEvidence } from './verify-pr366-deployment-evidence.mjs';

const mounted = { denialVisible: false, listVisible: true, detailVisible: true, refreshVisible: true };
const cleared = { denialVisible: true, listVisible: false, detailVisible: false, refreshVisible: false };
function harness(mode, sessionStatus = 401) {
  let state = { ...mounted }; const saves = [];
  const refresh = vi.fn(async () => {
    if (mode === 'failed-clear') return;
    state = { ...cleared };
    if (mode === 'race') throw Error('click target removed with private diagnostics');
  });
  const operations = {
    load: vi.fn(async () => { expect(state.listVisible).toBe(true); }),
    readAuthorizedSession: vi.fn(async () => 200),
    logout: vi.fn(async () => { if (mode === 'early') state = { ...cleared }; return 200; }),
    readSession: vi.fn(async () => sessionStatus),
    dom: async () => ({ ...state, sessionToken: 'must-not-be-recorded', privateText: 'must-not-be-recorded' }),
    refresh,
    verifyCleared: async () => {
      if (!state.denialVisible || state.listVisible || state.detailVisible) throw Error('private content remains');
    },
    save: async value => saves.push(structuredClone(value)),
  };
  return { operations, saves, refresh };
}

test.each(['early', 'clickable', 'race'])('session revocation proves 401 and private-state clearing through %s path', async mode => {
  const { operations, saves, refresh } = harness(mode);
  const result = await verifySessionRevocation(operations);
  expect(result.status).toBe('PASS');
  expect(operations.logout).toHaveBeenCalledOnce(); expect(operations.readSession).toHaveBeenCalledOnce();
  expect(refresh).toHaveBeenCalledTimes(mode === 'early' ? 0 : 1);
  expect(result.steps).toContainEqual({ stage: 'SESSION_READBACK', httpStatus: 401 });
  expect(result.steps.at(-1)).toMatchObject({ stage: 'VERIFY_PRIVATE_STATE_CLEARED', ...cleared });
  expect(JSON.stringify(saves)).not.toMatch(/must-not-be-recorded|private diagnostics/);
  const binding = { resourceKey: 'manual-123', childRef: 'isolated-child', deploymentId: 'dpl_isolated', sha: 'a'.repeat(40), tree: 'b'.repeat(40) };
  // Feed the actual writer output to the release reader, including both refresh paths.
  expect(() => verifySessionEvidence({ ...binding, ...result }, binding)).not.toThrow();
  expect(() => verifySessionEvidence({ ...binding, ...result, sha: 'c'.repeat(40) }, binding)).toThrow('EVIDENCE_SESSION_PROOF');
});

test('a cleared UI cannot mask a session that is still valid', async () => {
  const { operations, saves } = harness('early', 200);
  await expect(verifySessionRevocation(operations)).rejects.toThrow('PREVIEW_SESSION_NOT_REVOKED');
  expect(saves.at(-1)).toMatchObject({ status: 'FAIL', failure: { stage: 'SESSION_READBACK' } });
});

test('a revoked session cannot mask retained private UI', async () => {
  const { operations, saves } = harness('failed-clear');
  await expect(verifySessionRevocation(operations)).rejects.toThrow('private content remains');
  expect(saves.at(-1)).toMatchObject({ status: 'FAIL', failure: { stage: 'VERIFY_PRIVATE_STATE_CLEARED' } });
  expect(JSON.stringify(saves)).not.toContain('private content remains');
});

test('failed logout remains failed even when UI is already cleared', async () => {
  const { operations, saves } = harness('early'); operations.logout = async () => 403;
  await expect(verifySessionRevocation(operations)).rejects.toThrow('PREVIEW_SESSION_LOGOUT_DENIED');
  expect(saves.at(-1)).toMatchObject({ status: 'FAIL', failure: { stage: 'LOGOUT' } });
});

test('an already invalid session fails before logout', async () => {
  const { operations, saves } = harness('early'); operations.readAuthorizedSession = async () => 401;
  await expect(verifySessionRevocation(operations)).rejects.toThrow('PREVIEW_SESSION_PRECONDITION_FAILED');
  expect(operations.logout).not.toHaveBeenCalled();
  expect(saves.at(-1)).toMatchObject({ status: 'FAIL', failure: { stage: 'AUTHORIZED_SESSION_READBACK' } });
});

test.each(['listVisible', 'detailVisible'])('missing private %s fails before logout', async key => {
  const { operations } = harness('early'); const dom = operations.dom;
  operations.dom = async () => ({ ...await dom(), [key]: false });
  await expect(verifySessionRevocation(operations)).rejects.toThrow('PREVIEW_SESSION_PRECONDITION_FAILED');
  expect(operations.logout).not.toHaveBeenCalled();
});
