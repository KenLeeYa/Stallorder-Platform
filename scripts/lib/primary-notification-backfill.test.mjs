import { readFileSync } from 'node:fs';
import { test, expect } from 'vitest';

test('legacy read backfill stays outside DR schema Apply and preserves existing receipts', () => {
  const migration = readFileSync('supabase/migrations/20261001120000_personal_notification_inbox.sql', 'utf8');
  const fixture = readFileSync('supabase/fixtures/primary_notification_read_receipts_backfill.sql', 'utf8');
  expect(migration).not.toMatch(/INSERT INTO public\.notification_read_receipts/i);
  expect(fixture).toMatch(/backend_code = 'PRIMARY'/);
  expect(fixture).toMatch(/backend_role = 'ACTIVE_WRITER' AND writes_enabled/);
  expect(fixture).toMatch(/SELECT profile_id,id,read_at FROM public\.merchant_application_notifications WHERE read_at IS NOT NULL/);
  expect(fixture).toMatch(/ON CONFLICT\(profile_id,application_notification_id\) DO NOTHING/);
  expect(fixture).toContain('PRIMARY_NOTIFICATION_BACKFILL_INCOMPLETE');
  expect(fixture).toContain('missing_legacy_read_receipts');
  expect(fixture).toContain('AND enforcement_enabled');
  expect(fixture).toContain('app_private.assert_backend_writable()');
});

test('Production schema Apply automatically backfills before Edge and application rollout', () => {
  const workflow = readFileSync('.github/workflows/production-readiness.yml', 'utf8');
  const step = 'name: Backfill legacy notification read receipts on the verified Primary writer';
  const index = workflow.indexOf(step);
  expect(index).toBeGreaterThan(workflow.indexOf('name: Verify applied migration history'));
  expect(index).toBeLessThan(workflow.indexOf('name: Deploy Production Edge Functions'));
  expect(index).toBeLessThan(workflow.indexOf('name: Promote approved deployment and smoke Production'));
  const body = workflow.slice(index, workflow.indexOf('name: Deploy Production Edge Functions'));
  expect(body).toMatch(/if: inputs\.apply_migrations/);
  expect(body).toContain('psql --dbname "$SUPABASE_CI_DATABASE_URL"');
  expect(body).toContain('--no-psqlrc --set ON_ERROR_STOP=1');
  expect(body).toContain('--file supabase/fixtures/primary_notification_read_receipts_backfill.sql');
});
