import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateHost, validateBundleReceipt, validateExtensions, validateRuntimePath,
  authorizationDenied, extensions, preparation, nixOptions } from '../verify-native-postgres-runner.mjs';

const env = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted', RUNNER_OS: 'Linux',
  RUNNER_ARCH: 'X64', ImageOS: 'ubuntu24', GITHUB_EVENT_NAME: 'push',
  GITHUB_REF: 'refs/heads/codex/primary-only-preparation',
  GITHUB_REPOSITORY: 'KenLeeYa/Stallorder-Platform', GITHUB_SHA: 'a'.repeat(40), GITHUB_RUN_ID: '1',
  GITHUB_RUN_ATTEMPT: '1', ImageVersion: 'synthetic-image-version', RUNNER_TEMP: '/tmp/pr366', HOME: '/home/runner' };
const event = { repository: { full_name: env.GITHUB_REPOSITORY, private: false, fork: false },
  ref: env.GITHUB_REF, after: env.GITHUB_SHA, deleted: false, forced: false };
const receipt = { variant: 'cli', 'psql-version': '17.6', 'receipt-version': '1',
  extensions: ['supautils', 'pg_graphql', 'pgsodium', 'supabase_vault', 'pg_net', 'pg_cron', 'safeupdate'] };

test('supported host metadata is only an accidental-target guard', () => {
  assert.doesNotThrow(() => validateHost(env, event, 'linux', 'x64'));
  const plan = preparation();
  for (const name of ['executionPerformed', 'runtimeQualified', 'recoveryQualified', 'protectedPublicationQualified', 'releaseEligible']) assert.equal(plan[name], false);
});

for (const [key, value] of Object.entries({ RUNNER_ENVIRONMENT: 'self-hosted', RUNNER_OS: 'Windows',
  RUNNER_ARCH: 'ARM64', ImageOS: 'ubuntu22', GITHUB_EVENT_NAME: 'pull_request',
  GITHUB_REF: 'refs/heads/main', GITHUB_REPOSITORY: 'Other/Stallorder-Platform', GITHUB_SHA: 'main', GITHUB_RUN_ID: '0',
  GITHUB_RUN_ATTEMPT: '', ImageVersion: '', RUNNER_TEMP: '', HOME: '' })) {
  test(`refuses unsupported host metadata: ${key}`, () => assert.throws(() => validateHost({ ...env, [key]: value }, event, 'linux', 'x64')));
}

for (const [label, changed] of [['private', { private: true }], ['fork', { fork: true }],
  ['wrong repo', { full_name: 'Other/Repository' }], ['missing visibility', { private: undefined }]]) {
  test(`refuses ${label} repository`, () => assert.throws(() => validateHost(env, { ...event, repository: { ...event.repository, ...changed } }, 'linux', 'x64')));
}

for (const [label, changed] of [['wrong event ref', { ref: 'refs/heads/staging' }],
  ['moved source', { after: 'b'.repeat(40) }], ['deleted branch', { deleted: true }],
  ['forced update', { forced: true }], ['missing push state', { forced: undefined }]]) {
  test(`refuses ${label}`, () => assert.throws(() => validateHost(env, { ...event, ...changed }, 'linux', 'x64')));
}

test('manual dispatch and tag events cannot execute this branch-only qualification', () => {
  assert.throws(() => validateHost({ ...env, GITHUB_EVENT_NAME: 'workflow_dispatch' }, event, 'linux', 'x64'));
  assert.throws(() => validateHost({ ...env, GITHUB_REF: 'refs/tags/codex/primary-only-preparation' }, event, 'linux', 'x64'));
});
test('refuses non-Linux and non-x64 process platforms', () => {
  assert.throws(() => validateHost(env, event, 'win32', 'x64'), /NATIVE_LINUX_REQUIRED/);
  assert.throws(() => validateHost(env, event, 'linux', 'arm64'), /X64_REQUIRED/);
});

for (const key of ['PGHOST', 'PGSERVICEFILE', 'PGOPTIONS', 'DATABASE_URL', 'DIRECT_URL', 'SUPABASE_SERVICE_ROLE_KEY',
  'PRIMARY_DATABASE_URL', 'DR_DATABASE_URL', 'AWS_ACCESS_KEY_ID', 'CLOUDFLARE_API_TOKEN', 'CF_API_TOKEN',
  'VERCEL_TOKEN', 'GH_TOKEN', 'GITHUB_TOKEN', 'NODE_OPTIONS', 'NODE_PATH', 'NIX_CONFIG', 'NIX_USER_CONF_FILES', 'LD_PRELOAD', 'LD_LIBRARY_PATH']) {
  test(`rejects ambient credential or runtime override: ${key}`, () => {
    assert.throws(() => validateHost({ ...env, [key]: '' }, event, 'linux', 'x64'), /AMBIENT_CREDENTIAL_OR_OVERRIDE/);
  });
}

test('signed cache policy refuses IFD builds and flake-supplied configuration', () => {
  const options = {};
  for (let i = 0; i < nixOptions.length; i++) if (nixOptions[i] === '--option') options[nixOptions[++i]] = nixOptions[++i];
  assert.equal(options['allow-import-from-derivation'], 'false');
  assert.equal(options['accept-flake-config'], 'false');
  assert.equal(options['require-sigs'], 'true');
  assert.equal(options.fallback, 'false');
  assert.equal(options.builders, '');
  assert.equal(options.substituters, 'https://nix-postgres-artifacts.s3.amazonaws.com');
  assert.equal(options['trusted-public-keys'], 'nix-postgres-artifacts:dGZlQOvKcNEjvT7QEAJbcV6b6uk7VF/hWMjhYleiaLI=');
});

test('copy target must be a literal expected store output', () => {
  const value = `/nix/store/${'a'.repeat(32)}-psql_17_cli_portable`;
  assert.equal(validateRuntimePath(value), value);
  for (const bad of ['github:supabase/postgres#portable', '--all', '/tmp/postgres', `${value}\n${value}`, `${value}/../../other`, value.replace('portable', 'server')]) assert.throws(() => validateRuntimePath(bad));
});

test('portable receipt requires exact version, variant and unique complete library set', () => {
  assert.doesNotThrow(() => validateBundleReceipt(receipt));
  for (const changed of [{ variant: 'server' }, { 'psql-version': '17.11' }, { 'receipt-version': 1 },
    { extensions: receipt.extensions.slice(1) }, { extensions: [...receipt.extensions, 'safeupdate'] }]) {
    assert.throws(() => validateBundleReceipt({ ...receipt, ...changed }));
  }
});

test('SQL readback binds Nix-patched SQL versions, missing and duplicate extensions fail', () => {
  const rows = Object.entries(extensions).map(([name, version]) => ({ name, version }));
  assert.doesNotThrow(() => validateExtensions(rows));
  assert.throws(() => validateExtensions(rows.slice(1)), /EXTENSION_SET/);
  assert.throws(() => validateExtensions([...rows, rows[0]]), /EXTENSION_SET/);
  assert.throws(() => validateExtensions(rows.map(r => r.name === 'pg_cron' ? { ...r, version: '1.6' } : r)), /EXTENSION_VERSION_pg_cron/);
  assert.throws(() => validateExtensions(rows.map(r => ({ ...r, version: 'unknown' }))));
});

test('RLS denial needs insufficient-privilege SQLSTATE, not a generic failure', () => {
  assert.doesNotThrow(() => authorizationDenied({ code: 1, stderr: 'ERROR:  42501: permission denied for table pr366_catalog' }));
  for (const value of [{ code: 0, stderr: 'ERROR: 42501: synthetic' }, { code: 1, stderr: 'connection refused' },
    { code: 1, stderr: 'ERROR: 42601: syntax error' }, { code: null, stderr: 'ERROR: 42501: synthetic' }]) assert.throws(() => authorizationDenied(value));
});

const script = fileURLToPath(new URL('../verify-native-postgres-runner.mjs', import.meta.url));
const child = args => spawnSync(process.execPath, [script, ...args], {
  encoding: 'utf8', timeout: 10000, windowsHide: true,
  // No inherited provider credentials or GitHub host marker; never starts the runtime.
  env: { ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
});
test('actual plan CLI binds fixture bytes without qualifying a runtime or release', () => {
  const result = child(['--plan']);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.executionPerformed, false);
  assert.equal(plan.sources.length, 6);
  assert.ok(plan.sources.every(s => s.bytes > 0 && /^[a-f0-9]{64}$/.test(s.sha256)));
  assert.equal(plan.releaseEligible, false);
});
test('actual run CLI refuses an unqualified host before event reads and directory creation', () => {
  const result = child(['--run']);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /NATIVE_LINUX_REQUIRED|GITHUB_ACTIONS_REQUIRED/);
  assert.equal(result.stdout, '');
});
test('actual CLI refuses unknown mode and extra runtime inputs', () => {
  for (const args of [[], ['--restore'], ['--plan', 'postgres://example.invalid/db']]) {
    const result = child(args);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /MODE_REQUIRED|MODE_REJECTED/);
    assert.equal(result.stdout, '');
  }
});
