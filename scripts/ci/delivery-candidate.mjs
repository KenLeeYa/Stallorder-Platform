import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const source = resolve(root, 'scripts/ci/delivery-source');
const frozen = {
  base: '4e95d2ea5d53ae78c5af9c3db044481237674c44',
  commit: '79f5ec8d98d9ccdb61f80d06071a2102908c54df',
  tree: 'd215e9f212d5647701f0d19e7212f6f5dadb8f1a',
};
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const gitHash = (bytes) => createHash('sha1')
  .update(`commit ${bytes.length}\0`).update(bytes).digest('hex');

export function validateSourceBundle({ manifest, patch, commit }) {
  for (const key of Object.keys(frozen)) {
    assert.equal(manifest[key], frozen[key], `frozen ${key} mismatch`);
  }
  assert.equal(hash(patch), manifest.patchSha256, 'patch digest mismatch');
  assert.equal(hash(commit), manifest.commitSha256, 'commit digest mismatch');
  assert.equal(gitHash(commit), frozen.commit, 'Git commit identity mismatch');
  assert.match(commit.toString('utf8'), new RegExp(`^tree ${frozen.tree}\nparent ${frozen.base}\n`));
  assert.ok(Array.isArray(manifest.paths) && manifest.paths.length === 38, 'paths count');
  assert.equal(new Set(manifest.paths).size, 38, 'duplicate paths');
  for (const path of manifest.paths) {
    assert.ok(typeof path === 'string' && !/[:\\\x00-\x1f]/.test(path)
      && path.split('/').every((part) => part && part !== '.' && part !== '..'), 'unsafe paths');
  }
  return manifest;
}

export function validateRuntimeRole(value) {
  assert.equal(value.current_user, 'postgres', 'unexpected actual runtime principal');
  assert.equal(value.session_user, 'postgres', 'runtime role switching is not parity');
  assert.equal(value.superuser, false, 'runtime must not be superuser');
  assert.equal(value.bypassrls, true, 'runtime BYPASSRLS differs from observed Primary role');
  assert.equal(value.service_member, true, 'runtime service membership differs');
  assert.equal(value.helper_execute, true, 'runtime cannot execute delivery helper');
  assert.equal(value.owners?.length, 5, 'five exact affected definers are required');
  assert.equal(new Set(value.owners.map((item) => item.name)).size, 5, 'duplicate definers');
  for (const owner of value.owners) {
    assert.equal(owner.owner, 'postgres', 'definer owner differs from Primary');
    assert.equal(owner.superuser, false, 'definer must not be superuser');
    assert.equal(owner.bypassrls, true, 'definer BYPASSRLS differs');
  }
  return true;
}

function loadBundle() {
  return { manifest: JSON.parse(readFileSync(resolve(source, 'manifest.json'))),
    patch: readFileSync(resolve(source, 'candidate.patch')),
    commit: readFileSync(resolve(source, 'commit.txt')) };
}

function hostedOnly() {
  assert.equal(process.env.GITHUB_ACTIONS, 'true', 'only the isolated hosted runner may execute');
  assert.equal(process.env.GITHUB_REPOSITORY, 'KenLeeYa/Stallorder-Platform');
  assert.equal(process.env.RUNNER_ENVIRONMENT, 'github-hosted');
  assert.equal(process.env.RUNNER_OS, 'Linux');
}

function materialize() {
  hostedOnly();
  const bundle = loadBundle();
  const manifest = validateSourceBundle(bundle);
  const product = resolve(root, '../product');
  assert.ok(!existsSync(product), 'refuse to overwrite an existing product directory');
  mkdirSync(product);
  const git = (args, input) => execFileSync('git', args,
    { cwd: product, input, maxBuffer: 8 * 1024 * 1024 }).toString().trim();
  git(['init', '--quiet']);
  git(['config', 'core.autocrlf', 'false']);
  git(['fetch', '--no-tags', '--depth=1',
    'https://github.com/KenLeeYa/Stallorder-Platform.git', frozen.base]);
  git(['checkout', '--quiet', '--detach', frozen.base]);
  git(['apply', '--check', '--index', '--binary', '-'], bundle.patch);
  git(['apply', '--index', '--binary', '-'], bundle.patch);
  assert.deepEqual(git(['diff', '--cached', '--name-only', '-z']).split('\0').filter(Boolean).sort(),
    [...manifest.paths].sort(), 'changed paths differ from frozen scope');
  assert.equal(git(['write-tree']), frozen.tree, 'reconstructed product tree mismatch');
  assert.equal(git(['hash-object', '-t', 'commit', '-w', '--stdin'], bundle.commit), frozen.commit);
  git(['checkout', '--quiet', '--detach', frozen.commit]);
  assert.equal(git(['status', '--porcelain']), '', 'product must be clean');
  console.log(JSON.stringify({ controlCommit: process.env.GITHUB_SHA, ...frozen,
    paths: manifest.paths.length, sourceVerified: true, releaseQualified: false }));
}

async function runtimeRole() {
  hostedOnly();
  const product = resolve(root, '../product');
  assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: product }).toString().trim(), frozen.commit);
  const database = new URL(process.env.DATABASE_URL);
  assert.equal(database.hostname, '127.0.0.1', 'only the owned local runner database is allowed');
  assert.equal(database.port, '54322');
  assert.equal(database.pathname, '/postgres');
  const { getPrismaClient } = await import(pathToFileURL(resolve(product, 'src/lib/prisma.ts')).href);
  const client = getPrismaClient();
  try {
    const [row] = await client.$queryRawUnsafe(`select jsonb_build_object(
      'current_user',current_user,'session_user',session_user,
      'superuser',r.rolsuper,'bypassrls',r.rolbypassrls,
      'service_member',pg_has_role(current_user,'service_role','MEMBER'),
      'helper_execute',has_function_privilege(current_user,
        'public.delivery_ordering_unavailable_code(uuid,timestamptz)','EXECUTE'),
      'owners',(select jsonb_agg(jsonb_build_object('name',p.oid::regprocedure::text,
        'owner',o.rolname,'superuser',o.rolsuper,'bypassrls',o.rolbypassrls))
        from pg_proc p join pg_roles o on o.oid=p.proowner where p.oid in (
          'public.delivery_ordering_unavailable_code(uuid,timestamptz)'::regprocedure,
          'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamptz,uuid,jsonb,boolean,text)'::regprocedure,
          'public.issue_order_session_with_schedule(text,text,text,text,text,text,text,text)'::regprocedure,
          'app_private.issue_order_session_with_schedule_targeted(text,text,text,text,text,text,text,text)'::regprocedure,
          'public.create_public_order_legacy(uuid,text,text,text,text,text,text,uuid,text,text,text,jsonb,text,text,text)'::regprocedure))
      ) as receipt from pg_roles r where r.rolname=current_user`);
    console.log(JSON.stringify({ productCommit: frozen.commit, runtime: row.receipt,
      productionRuntimeVerified: false }));
    validateRuntimeRole(row.receipt);
    const [result] = await client.$queryRawUnsafe(`select public.delivery_ordering_unavailable_code(
      '00000000-0000-0000-0000-000000000000'::uuid,now()) as code`);
    assert.equal(result.code, 'DELIVERY_OUTSIDE_ORDERING_HOURS');
  } finally { await client.$disconnect(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === 'materialize') materialize();
  else if (process.argv[2] === 'role') await runtimeRole();
  else if (process.argv[2] === 'verify') console.log(JSON.stringify(validateSourceBundle(loadBundle())));
  else throw new Error('Expected verify, materialize or role');
}
