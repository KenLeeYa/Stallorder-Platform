// Synthetic qualification candidate for a disposable public GitHub Ubuntu VM.
// No database URL, archive, credentials, Docker, or provider mutation inputs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

export const upstream = 'c2c2d5c7b31f87d41f26481661eb762c00300855';
export const installable = `github:supabase/postgres/${upstream}#packages.x86_64-linux.psql_17_cli_portable`;
export const fixturePins = {
  'scripts/fixtures/rls-restore/roles.sql': 'cc453cc2c5d448ea40861032e8896c433d6fa9c2019aa903d3b8f50e5a3fd474',
  'scripts/fixtures/rls-restore/schema.sql': '9776fe5bf27da08c1b494f8840c2e20eab876d567a7d70f233f7e0b11f194f5a',
};
export const extensions = { pg_cron: '1.6.4', pg_graphql: '1.6.1', pg_net: '0.20.4', pgsodium: '3.1.8', supabase_vault: '0.3.1' };
const libraries = ['supautils', 'pg_graphql', 'pgsodium', 'supabase_vault', 'pg_net', 'pg_cron', 'safeupdate'];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = b => createHash('sha256').update(b).digest('hex');
const GiB = 1024 ** 3;
export const nixOptions = ['--extra-experimental-features', 'nix-command flakes', '--option', 'accept-flake-config', 'false',
  '--option', 'substituters', 'https://nix-postgres-artifacts.s3.amazonaws.com', '--option', 'trusted-public-keys',
  'nix-postgres-artifacts:dGZlQOvKcNEjvT7QEAJbcV6b6uk7VF/hWMjhYleiaLI=', '--option', 'require-sigs', 'true',
  '--option', 'allow-import-from-derivation', 'false', '--option', 'fallback', 'false', '--option', 'builders', '', '--option', 'max-jobs', '0'];

export function validateRuntimePath(value) {
  assert.match(value, /^\/nix\/store\/[a-z0-9]{32}-psql_17_cli_portable(?:-[0-9.]+)?$/, 'NIX_OUTPUT_PATH');
  return value;
}

// These are accidental-target guards, not an independent trust/approval boundary.
export function validateHost(env, event, platform, arch) {
  assert.equal(platform, 'linux', 'NATIVE_LINUX_REQUIRED');
  assert.equal(arch, 'x64', 'X64_REQUIRED');
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted',
    RUNNER_OS: 'Linux', RUNNER_ARCH: 'X64', ImageOS: 'ubuntu24', GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/heads/codex/primary-only-preparation',
    GITHUB_REPOSITORY: 'KenLeeYa/Stallorder-Platform' })) assert.equal(env[key], value, `HOST_${key}`);
  assert.equal(event.repository?.full_name, env.GITHUB_REPOSITORY, 'REPOSITORY_MISMATCH');
  assert.equal(event.repository?.private, false, 'PUBLIC_REPOSITORY_REQUIRED');
  assert.equal(event.repository?.fork, false, 'FORK_REJECTED');
  assert.match(env.GITHUB_SHA ?? '', /^[0-9a-f]{40}$/, 'IMMUTABLE_SOURCE_REQUIRED');
  assert.equal(event.ref, env.GITHUB_REF, 'PUSH_REF_MISMATCH');
  assert.equal(event.after, env.GITHUB_SHA, 'PUSH_SHA_MISMATCH');
  assert.equal(event.deleted, false, 'DELETED_PUSH_REJECTED');
  assert.equal(event.forced, false, 'FORCED_PUSH_REJECTED');
  for (const key of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT']) assert.match(env[key] ?? '', /^[1-9][0-9]*$/, key);
  assert.ok(env.ImageVersion && env.RUNNER_TEMP && env.HOME, 'HOST_METADATA_REQUIRED');
  const forbidden = /^(?:PG\w*|DATABASE_URL|DIRECT_URL|SUPABASE_\w*|PRIMARY_\w*|DR_\w*|AWS_\w*|CLOUDFLARE_\w*|CF_API_\w*|VERCEL_\w*|GH_TOKEN|GITHUB_TOKEN|NODE_OPTIONS|NODE_PATH|NIX_CONFIG|NIX_USER_CONF_FILES|LD_PRELOAD|LD_LIBRARY_PATH)$/i;
  assert.ok(!Object.keys(env).some(key => forbidden.test(key)), 'AMBIENT_CREDENTIAL_OR_OVERRIDE');
}

export function validateBundleReceipt(receipt) {
  assert.equal(receipt.variant, 'cli', 'BUNDLE_VARIANT');
  assert.equal(receipt['psql-version'], '17.6', 'BUNDLE_VERSION');
  assert.equal(receipt['receipt-version'], '1', 'BUNDLE_RECEIPT_VERSION');
  assert.deepEqual([...receipt.extensions].sort(), [...libraries].sort(), 'BUNDLE_EXTENSION_SET');
}

export function validateExtensions(rows) {
  assert.deepEqual(rows.map(r => r.name).sort(), Object.keys(extensions).sort(), 'EXTENSION_SET');
  for (const row of rows) assert.equal(row.version, extensions[row.name], `EXTENSION_VERSION_${row.name}`);
}

export function authorizationDenied(result) {
  assert.equal(result.code, 1, 'DENIAL_EXIT');
  assert.match(result.stderr, /ERROR:\s+42501:/, 'DENIAL_MUST_BE_INSUFFICIENT_PRIVILEGE');
}

function sourceInventory() {
  return ['scripts/verify-native-postgres-runner.mjs', 'scripts/tests/native-postgres-runner.test.mjs',
    '.github/workflows/pr366-native-postgres.yml', 'vercel.json', ...Object.keys(fixturePins)].map(file => {
    const b = fs.readFileSync(path.join(root, file));
    if (fixturePins[file]) assert.equal(hash(b), fixturePins[file], 'FIXTURE_SOURCE_CHANGED');
    return { path: file, bytes: b.length, sha256: hash(b) };
  });
}

export function preparation() {
  return { schema: 'pr366-native-postgres-probe/v1', mode: 'PREPARATION_ONLY', upstream, installable,
    sources: sourceInventory(), nixVersion: '2.34.9', cacheOnly: true, signaturesRequired: true,
    dockerUsed: false, providerMutation: false, syntheticOnly: true, executionPerformed: false,
    runtimeQualified: false, recoveryQualified: false, protectedPublicationQualified: false, releaseEligible: false };
}

async function run() {
  // Refuse unsupported hosts before reading event data or creating any directory.
  assert.equal(process.platform, 'linux', 'NATIVE_LINUX_REQUIRED');
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'GITHUB_ACTIONS_REQUIRED');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  validateHost(process.env, event, process.platform, process.arch);
  assert.equal(process.execArgv.length, 0, 'NODE_OVERRIDES');
  const receipt = { ...preparation(), mode: 'SYNTHETIC_RUNTIME', executionPerformed: true,
    startedAt: new Date().toISOString(), sourceSha: process.env.GITHUB_SHA,
    runId: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
    imageVersion: process.env.ImageVersion, nodeVersion: process.version,
    nodeSha256: hash(fs.readFileSync(process.execPath)), commands: [], checks: [], cleanup: false };
  const parent = fs.realpathSync(process.env.RUNNER_TEMP);
  assert.equal(parent, path.resolve(process.env.RUNNER_TEMP), 'TEMP_LINK');
  assert.match(parent, /^\/[A-Za-z0-9_./-]+$/, 'TEMP_PATH_CHARACTERS');
  assert.ok(fs.statfsSync(parent).bavail * fs.statfsSync(parent).bsize >= 8 * GiB, 'MINIMUM_8_GIB_FREE');
  const dir = fs.mkdtempSync(path.join(parent, 'pr366-native-'));
  fs.chmodSync(dir, 0o700);
  const env = { HOME: dir, TMPDIR: dir, PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C',
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0' };
  let activeChild, activeData, runtime, cancelled = false;
  const signal = () => {
    cancelled = true;
    if (activeChild?.pid) try { process.kill(-activeChild.pid, 'SIGTERM'); } catch { /* interval still enforces cancellation */ }
  };
  process.on('SIGTERM', signal); process.on('SIGINT', signal);

  async function command(file, args, options = {}) {
    if (cancelled && !options.cleanup) throw Error('CANCELLED');
    const started = Date.now();
    const result = await new Promise(resolve => {
      let stdout = '', stderr = '', failure, timer, killTimer;
      const child = spawn(file, args, { cwd: root, env: { ...env, ...options.env }, detached: true,
        stdio: ['ignore', 'pipe', 'pipe'] });
      activeChild = child;
      function abort(reason) {
        if (failure) return;
        failure = reason;
        if (child.pid) {
          try { process.kill(-child.pid, 'SIGTERM'); } catch (e) { if (e.code !== 'ESRCH') failure = e.code; }
          killTimer = setTimeout(() => { try { process.kill(-child.pid, 'SIGKILL'); } catch { /* already exited */ } }, 3000);
        }
      }
      child.stdout.on('data', b => { if (!failure) { stdout += b; if (stdout.length + stderr.length > 4 * 1024 * 1024) abort('OUTPUT_LIMIT'); } });
      child.stderr.on('data', b => { if (!failure) { stderr += b; if (stdout.length + stderr.length > 4 * 1024 * 1024) abort('OUTPUT_LIMIT'); } });
      child.on('error', error => { failure = error.code ?? 'SPAWN_FAILED'; });
      child.on('close', (code, sig) => {
        clearInterval(timer); clearTimeout(killTimer); activeChild = undefined;
        resolve({ code, signal: sig, failure: failure ?? null, stdout, stderr, elapsedMs: Date.now() - started });
      });
      timer = setInterval(() => {
        if (Date.now() - started > (options.timeout ?? 60000)) abort('TIME_LIMIT');
        else if (cancelled && !options.cleanup) abort('CANCELLED');
        else if (!options.cleanup) { const s = fs.statfsSync(parent); if (s.bavail * s.bsize < 2 * GiB) abort('DISK_FLOOR'); }
      }, 250);
    });
    receipt.commands.push({ file, args, ...result });
    assert.equal(result.failure, null, 'CHILD_INTERRUPTED');
    if (!options.expectedFailure) assert.equal(result.code, 0, 'CHILD_FAILED');
    return result;
  }

  const sql = (text, database = 'postgres', user = 'postgres', expectedFailure = false) => command(`${runtime}/bin/psql`,
    ['-X', '-Atq', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose', '-h', dir, '-p', '5432', '-U', user, '-d', database, '-c', text], { expectedFailure });
  const check = async (name, query, expected, database = 'postgres', user = 'postgres') => {
    assert.equal((await sql(query, database, user)).stdout.trim(), expected, name); receipt.checks.push(name);
  };
  async function stop() {
    if (!activeData) return;
    if (fs.existsSync(path.join(activeData, 'postmaster.pid'))) await command(`${runtime}/bin/pg_ctl`, ['-D', activeData, '-m', 'fast', '-w', '-t', '30', 'stop'], { cleanup: true });
    const status = await command(`${runtime}/bin/pg_ctl`, ['-D', activeData, 'status'], { expectedFailure: true, cleanup: true });
    assert.equal(status.code, 3, 'POSTGRES_NOT_STOPPED');
    assert.equal(fs.existsSync(path.join(activeData, 'postmaster.pid')), false, 'POSTMASTER_PID_REMAINS');
    activeData = undefined;
  }
  async function start(name) {
    activeData = path.join(dir, name);
    await command(`${runtime}/bin/initdb`, ['-D', activeData, '--username=postgres', '--auth-local=trust', '--auth-host=reject', '--encoding=UTF8', '--locale=C']);
    fs.appendFileSync(path.join(activeData, 'postgresql.conf'), `\nlisten_addresses = ''\nunix_socket_directories = '${dir}'\nunix_socket_permissions = 0700\nmax_connections = 12\nshared_buffers = '32MB'\nmax_wal_size = '96MB'\nmin_wal_size = '32MB'\nshared_preload_libraries = 'supautils,pg_cron,pg_net,pgsodium,supabase_vault,pg_stat_statements'\ncron.database_name = 'postgres'\ncron.launch_active_jobs = off\npgsodium.getkey_script = '${dir}/synthetic-getkey'\nvault.getkey_script = '${dir}/synthetic-getkey'\n`);
    await command(`${runtime}/bin/pg_ctl`, ['-D', activeData, '-l', path.join(dir, `${name}.log`), '-w', '-t', '30', 'start']);
    await check(`${name}:server-version`, 'SHOW server_version_num', '170006');
    await check(`${name}:no-tcp`, 'SHOW listen_addresses', '');
    await check(`${name}:socket`, 'SHOW unix_socket_directories', dir);
  }
  async function verifyRoles(label) {
    await check(`${label}:force-owner`, "SELECT relrowsecurity AND relforcerowsecurity AND relowner='pr366_owner'::regrole FROM pg_class WHERE oid='public.pr366_catalog'::regclass", 't', 'pr366_rls');
    await check(`${label}:role-flags`, "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'pr366_%' AND NOT (rolsuper OR rolbypassrls OR rolcreatedb OR rolcreaterole OR rolreplication)", '5', 'pr366_rls');
    for (const user of ['pr366_tenant_a', 'pr366_tenant_b']) {
      await check(`${label}:${user}:own`, 'SELECT count(*) FROM public.pr366_catalog WHERE tenant=session_user', '1', 'pr366_rls', user);
      await check(`${label}:${user}:cross`, 'SELECT count(*) FROM public.pr366_catalog WHERE tenant<>session_user', '0', 'pr366_rls', user);
      authorizationDenied(await sql('SET ROLE pr366_owner', 'pr366_rls', user, true));
      const other = user === 'pr366_tenant_a' ? 'pr366_tenant_b' : 'pr366_tenant_a';
      authorizationDenied(await sql(`INSERT INTO public.pr366_catalog VALUES (3,'${other}','blocked','synthetic/blocked.bin')`, 'pr366_rls', user, true));
    }
    await check(`${label}:owner-filtered`, 'SET ROLE pr366_owner; SELECT count(*) FROM public.pr366_catalog', '0', 'pr366_rls');
    await check(`${label}:observer-all`, 'SELECT count(*) FROM public.pr366_catalog', '2', 'pr366_rls', 'pr366_observer');
    for (const query of ['UPDATE public.pr366_catalog SET name=\'bad\'', 'SET row_security=off; SELECT * FROM public.pr366_catalog']) authorizationDenied(await sql(query, 'pr366_rls', 'pr366_observer', true));
    receipt.checks.push(`${label}:authorization-denials`);
    return (await sql(`SELECT json_build_object('rows',(SELECT json_agg(t ORDER BY id) FROM public.pr366_catalog t),
      'policies',(SELECT json_agg(t ORDER BY policyname) FROM pg_policies t WHERE schemaname='public'),
      'grants',(SELECT json_agg(t ORDER BY grantee,privilege_type) FROM information_schema.role_table_grants t WHERE table_schema='public'),
      'roles',(SELECT json_agg(t ORDER BY rolname) FROM (SELECT rolname,rolcanlogin,rolsuper,rolbypassrls,rolcreatedb,rolcreaterole,rolreplication FROM pg_roles WHERE rolname LIKE 'pr366_%') t))`, 'pr366_rls')).stdout.trim();
  }

  try {
    await checkSource();
    receipt.kernel = (await command('/usr/bin/uname', ['-srvmo'])).stdout.trim();
    receipt.libc = (await command('/usr/bin/ldd', ['--version'])).stdout.trim();
    const nix = path.join(process.env.HOME, '.nix-profile/bin/nix');
    assert.equal((await command(nix, ['--version'])).stdout.trim(), 'nix (Nix) 2.34.9', 'NIX_VERSION');
    // max-jobs=0 alone still permits preferLocalBuild. Never call a build command.
    runtime = validateRuntimePath((await command(nix, [...nixOptions, 'eval', '--raw', `${installable}.outPath`, '--no-update-lock-file', '--no-write-lock-file'], { timeout: 5 * 60 * 1000 })).stdout.trim());
    receipt.nixOutput = runtime;
    await command(nix, [...nixOptions, 'copy', '--from', 'https://nix-postgres-artifacts.s3.amazonaws.com', runtime], { timeout: 15 * 60 * 1000 });
    await command(nix, [...nixOptions, 'store', 'verify', '--recursive', '--sigs-needed', '1', runtime]);
    receipt.nixClosure = JSON.parse((await command(nix, [...nixOptions, 'path-info', '--recursive', '--json', runtime])).stdout);
    validateBundleReceipt(JSON.parse(fs.readFileSync(`${runtime}/cli-receipt.json`, 'utf8')));
    receipt.executables = [];
    for (const name of ['postgres', 'initdb', 'pg_ctl', 'psql', 'pg_dump', 'pg_restore', 'createdb', 'pg_config']) {
      assert.match((await command(`${runtime}/bin/${name}`, ['--version'])).stdout, /\b17\.6\b/, `BINARY_VERSION_${name}`);
      receipt.executables.push({ name, wrapperSha256: hash(fs.readFileSync(`${runtime}/bin/${name}`)), binarySha256: hash(fs.readFileSync(`${runtime}/bin/.${name}-wrapped`)) });
    }
    fs.writeFileSync(path.join(dir, 'synthetic-getkey'), `#!/bin/sh\nprintf '%s\\n' '${'1'.repeat(64)}'\n`, { mode: 0o700, flag: 'wx' });
    await start('source');
    await check('supautils-loaded', "SELECT count(*) FROM pg_settings WHERE name='supautils.superuser'", '1');
    await check('vault-loaded', "SELECT setting FROM pg_settings WHERE name='vault.getkey_script'", `${dir}/synthetic-getkey`);
    await sql("LOAD 'safeupdate'");
    for (const [name, version] of Object.entries(extensions)) await sql(`CREATE EXTENSION ${name} VERSION '${version}' CASCADE`);
    const extQuery = `SELECT coalesce(json_agg(json_build_object('name',extname,'version',extversion) ORDER BY extname),'[]'::json) FROM pg_extension WHERE extname IN (${Object.keys(extensions).map(n => `'${n}'`).join(',')})`;
    const sourceExtensions = (await sql(extQuery)).stdout.trim();
    validateExtensions(JSON.parse(sourceExtensions)); receipt.checks.push('extensions-created-and-loaded');
    await command(`${runtime}/bin/createdb`, ['-h', dir, '-U', 'postgres', 'pr366_rls']);
    for (const file of Object.keys(fixturePins)) await command(`${runtime}/bin/psql`, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-U', 'postgres', '-d', 'pr366_rls', '-f', path.join(root, file)]);
    const before = await verifyRoles('source');
    const sourceSystem = (await sql('SELECT system_identifier FROM pg_control_system()')).stdout.trim();
    const dump = path.join(dir, 'synthetic.dump');
    await command(`${runtime}/bin/pg_dump`, ['-h', dir, '-U', 'postgres', '-d', 'pr366_rls', '--format=custom', '--create', '--file', dump]);
    receipt.dumpSha256 = hash(fs.readFileSync(dump));
    await stop();
    await start('restored');
    assert.notEqual((await sql('SELECT system_identifier FROM pg_control_system()')).stdout.trim(), sourceSystem, 'DISTINCT_INITDB_REQUIRED');
    await check('empty-target', "SELECT count(*) FROM pg_database WHERE datname='pr366_rls'", '0');
    await command(`${runtime}/bin/psql`, ['-X', '-v', 'ON_ERROR_STOP=1', '-h', dir, '-U', 'postgres', '-d', 'postgres', '-f', path.join(root, 'scripts/fixtures/rls-restore/roles.sql')]);
    assert.equal(hash(fs.readFileSync(dump)), receipt.dumpSha256, 'DUMP_CHANGED');
    await command(`${runtime}/bin/pg_restore`, ['-h', dir, '-U', 'postgres', '--exit-on-error', '--create', '--dbname=postgres', dump]);
    assert.equal(await verifyRoles('restored'), before, 'SYNTHETIC_CATALOG_CHANGED');
    receipt.checks.push('fresh-cluster-dump-restore');
    await checkSource();
  } catch (error) { receipt.failure = String(error.message).slice(0,1000); }
  finally {
    try {
      await stop();
      assert.equal(fs.realpathSync(dir), dir, 'CLEANUP_LINK');
      assert.equal(path.dirname(dir), parent, 'CLEANUP_SCOPE');
      // This directory was created by this invocation, on the disposable Linux VM only.
      fs.rmSync(dir, { recursive: true });
      receipt.cleanup = !fs.existsSync(dir);
    } catch (error) { receipt.cleanupFailure = String(error.message).slice(0,1000); }
    process.off('SIGTERM', signal); process.off('SIGINT', signal);
  }
  receipt.runtimeQualified = !receipt.failure && !receipt.cleanupFailure && !cancelled && receipt.cleanup && receipt.checks.includes('fresh-cluster-dump-restore');
  receipt.completedAt = new Date().toISOString();
  // Always false: this probe has no Auth/Storage/application replay or protected authority.
  console.log(JSON.stringify(receipt));
  if (!receipt.runtimeQualified) process.exitCode = 1;

  async function checkSource() {
    const head = await command('/usr/bin/git', ['rev-parse', 'HEAD']);
    assert.equal(head.stdout.trim(), receipt.sourceSha, 'SOURCE_HEAD_DRIFT');
    await command('/usr/bin/git', ['ls-files', '--error-unmatch', '--', ...receipt.sources.map(s => s.path)]);
    await command('/usr/bin/git', ['diff', '--exit-code', 'HEAD', '--', ...receipt.sources.map(s => s.path)]);
    assert.deepEqual(sourceInventory(), receipt.sources, 'SOURCE_BYTES_DRIFT');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.argv.length, 3, 'MODE_REQUIRED');
    if (process.argv[2] === '--plan') console.log(JSON.stringify(preparation(), null, 2));
    else { assert.equal(process.argv[2], '--run', 'MODE_REJECTED'); await run(); }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
