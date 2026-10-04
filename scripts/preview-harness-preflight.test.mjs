import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { assertHostedSettings, captureDeployment, assertCashShift } from './preview-harness-preflight.mjs';

const env = { SUPABASE_ACCESS_TOKEN: 'synthetic', SUPABASE_PARENT_PROJECT_REF: 'parent',
  VERCEL_TOKEN: 'synthetic', VERCEL_ORG_ID: 'team', VERCEL_PROJECT_ID: 'project', PREVIEW_BYPASS_SECRET: 'synthetic' };
test('hosted settings fail closed without printing any supplied credential', () => {
  expect(assertHostedSettings(env)).toEqual({ status: 'SETTINGS_PRESENT', locale: 'zh-TW' });
  for (const key of Object.keys(env)) expect(() => assertHostedSettings({ ...env, [key]: '' })).toThrow(/^PREVIEW_SETTINGS_INCOMPLETE$/);
  expect(() => assertHostedSettings({ ...env, PREVIEW_BYPASS_SECRET: 'private\r\nheader' })).toThrow(/^PREVIEW_BYPASS_HEADER_INVALID$/);
});
test('deployment capture accepts supported JSON envelopes and returns only exact ID and origin', () => {
  const row = { id: 'dpl_test123', url: 'isolated.vercel.app', env: ['SECRET=private'] };
  for (const input of [row, { deployment: row }]) expect(captureDeployment(input)).toEqual({ id: row.id, url: 'https://isolated.vercel.app' });
});
test.each([
  {}, { id: 'dpl_test123' }, { id: 'bad', url: 'isolated.vercel.app' },
  ...['http://isolated.vercel.app', 'https://user:private@isolated.vercel.app', 'https://isolated.vercel.app?secret=private',
    'https://isolated.vercel.app/path', 'isolated.vercel.app.evil.test', 'https://isolated.vercel.app:444'].map(url => ({ id: 'dpl_test123', url })),
])('invalid capture fails without echoing provider payload: %#', input => {
  expect(() => captureDeployment(input)).toThrow(/^PREVIEW_DEPLOYMENT_CAPTURE_INVALID$/);
});
const shift = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', status: 'OPEN', openingAmount: 1000,
  organizationId: '11111111-1111-4111-8111-111111111111', stallId: '22222222-2222-4222-8222-222222222222',
  openedById: '55555555-5555-4555-8555-555555555552', note: 'PR366 manual-123 isolated shift' };
test('cash-shift readback verifies exact synthetic scope, owner, amount and marker', () => {
  expect(assertCashShift(shift, 'manual-123')).toBe(shift.id);
  for (const patch of [{ note: 'unowned' }, { stallId: 'foreign' }, { openedById: 'foreign' }, { status: 'CLOSED' }, { openingAmount: 0 }, { id: '../unsafe' }])
    expect(() => assertCashShift({ ...shift, ...patch }, 'manual-123')).toThrow(/^PREVIEW_CASH_SHIFT_READBACK_INVALID$/);
  expect(() => assertCashShift(null, 'manual-123')).toThrow(/^PREVIEW_CASH_SHIFT_READBACK_INVALID$/);
});
test('workflow checks hosted settings before resource creation and sanitizes deploy capture', () => {
  const workflow = readFileSync('.github/workflows/ephemeral-preview.yml', 'utf8');
  expect(workflow.indexOf('node scripts/preview-harness-preflight.mjs settings')).toBeGreaterThan(0);
  expect(workflow.indexOf('node scripts/preview-harness-preflight.mjs settings')).toBeLessThan(workflow.indexOf('Create or reuse data-less Preview Branch'));
  expect(workflow).toContain('node scripts/preview-harness-preflight.mjs deployment');
});
