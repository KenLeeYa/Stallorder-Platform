import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, unlinkSync, rmdirSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { validateSourceBundle, validateRuntimeRole } from './delivery-candidate.mjs';

const dir = new URL('./delivery-source/', import.meta.url);
const bundle = () => ({
  manifest: JSON.parse(readFileSync(new URL('manifest.json', dir))),
  patch: readFileSync(new URL('candidate.patch', dir)),
  commit: readFileSync(new URL('commit.txt', dir)),
});

test('accept the frozen 38-path product, independent of control commit', () => {
  assert.equal(validateSourceBundle(bundle()).tree, 'd215e9f212d5647701f0d19e7212f6f5dadb8f1a');
});
test('reject altered patch bytes before Git or dependency execution', () => {
  const value = bundle(); value.patch = Buffer.concat([value.patch, Buffer.from('\n')]);
  assert.throws(() => validateSourceBundle(value), /patch digest/);
});
test('reject a different product commit even when its checksum is recomputed', () => {
  const value = bundle(); value.commit = Buffer.concat([value.commit, Buffer.from('\n')]);
  value.manifest.commitSha256 = createHash('sha256').update(value.commit).digest('hex');
  assert.throws(() => validateSourceBundle(value), /Git commit/);
});
test('reject a different base or tree', () => {
  for (const key of ['base', 'tree']) {
    const value = bundle(); value.manifest[key] = 'a'.repeat(40);
    assert.throws(() => validateSourceBundle(value), /frozen/);
  }
});
test('reject duplicate or escaping input paths', () => {
  for (const invalid of ['../outside', 'src/../../outside', '/outside', 'C:/outside', 'duplicate']) {
    const value = bundle(); value.manifest.paths[1] = invalid === 'duplicate' ? value.manifest.paths[0] : invalid;
    assert.throws(() => validateSourceBundle(value), /paths/);
  }
});
test('reconstruct the exact product tree using an isolated index without changing worktree files', () => {
  const root = fileURLToPath(new URL('../../', import.meta.url));
  const temp = mkdtempSync(resolve(root, '.delivery-ci-index-'));
  const index = resolve(temp, 'index');
  const value = bundle();
  const git = (args, input) => execFileSync('git', ['-c', 'core.autocrlf=false', ...args], {
    cwd: root, input, env: { ...process.env, GIT_INDEX_FILE: index },
  }).toString().trim();
  try {
    git(['read-tree', value.manifest.base]);
    git(['apply', '--cached', '--binary', '-'], value.patch);
    assert.equal(git(['write-tree']), value.manifest.tree);
  } finally {
    if (existsSync(index)) unlinkSync(index);
    rmdirSync(temp);
  }
});
const role = () => ({ current_user: 'postgres', session_user: 'postgres',
  superuser: false, bypassrls: true, service_member: true, helper_execute: true,
  owners: Array.from({ length: 5 }, (_, i) => ({ name: String(i), owner: 'postgres', superuser: false, bypassrls: true })),
});
test('accept an actual non-superuser runtime and all five non-superuser definers', () => {
  assert.equal(validateRuntimeRole(role()), true);
});
test('reject superuser, missing execution right, role switching, or owner mismatch', () => {
  for (const delta of [{superuser:true}, {helper_execute:false}, {session_user:'supabase_admin'}, {owners:[]}]) {
    assert.throws(() => validateRuntimeRole({...role(), ...delta}));
  }
  const value = role(); value.owners[0].superuser = true;
  assert.throws(() => validateRuntimeRole(value));
});
