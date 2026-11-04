import test from 'node:test';
import assert from 'node:assert/strict';
import { RECOVERY_SIGNATURES, recoverySql, validateSnapshots } from './delivery-database-recovery.mjs';

function snapshots() {
  const functions = RECOVERY_SIGNATURES.map((signature, i) => ({ signature, oid: i === 4 ? null : 100 + i,
    definition: i === 4 ? null : `CREATE OR REPLACE FUNCTION public.example${i}() RETURNS text LANGUAGE sql AS 'SELECT ''before''::text';`,
    owner: i === 4 ? null : 'postgres', acl: i === 4 ? null : ['postgres=X/postgres'],
    config: i === 4 ? null : ['search_path=""'], securityDefiner: i === 4 ? null : true }));
  const before = { principal: { currentUser: 'postgres', sessionUser: 'postgres', database: 'postgres', superuser: false, bypassRls: true },
    functions, migrations: Array.from({ length: 146 }, (_, i) => ({ version: String(20260000000000 + i), statements: ['SELECT 1'], name: 'fixture' })) };
  const after = structuredClone(before);
  after.functions.forEach((f, i) => { f.definition = `CREATE OR REPLACE FUNCTION public.example${i}() RETURNS text LANGUAGE sql AS 'SELECT ''after''::text';`; if(i === 4) Object.assign(f, { oid: 104, owner: 'postgres', acl: ['postgres=X/postgres','service_role=X/postgres'], config: ['search_path=""'], securityDefiner: true }); });
  after.migrations.push({ version: '20261029090000', name: 'public_delivery_ordering_hours', statements: ['reviewed migration'] });
  return { before, after };
}
test('builds one transaction restoring exact definitions and history with CAS and RESTRICT', () => {
  const {before, after} = snapshots();
  assert.equal(validateSnapshots(before, after), true);
  const sql = recoverySql(before, after);
  assert.match(sql, /^BEGIN;/); assert.match(sql, /COMMIT;\n$/);
  assert.match(sql, /LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE/);
  assert.match(sql, /DELIVERY_RECOVERY_PREIMAGE_DRIFT/);
  assert.match(sql, /DROP FUNCTION public.delivery_ordering_unavailable_code\(uuid,timestamptz\) RESTRICT/);
  assert.match(sql, /GET DIAGNOSTICS removed = ROW_COUNT/);
  assert.match(sql, /DELIVERY_RECOVERY_POSTIMAGE_MISMATCH/);
  assert.doesNotMatch(sql, /CASCADE|TRUNCATE|DELETE FROM public\./);
});
for (const [name, change] of [
  ['wrong principal', (b,a) => { a.principal.superuser = true; }],
  ['missing original function', b => { b.functions[0].oid = null; }],
  ['wrong function identity', b => { b.functions[0].signature = 'public.foreign()'; }],
  ['changed original ACL', (b,a) => { a.functions[0].acl.push('anon=X/postgres'); }],
  ['changed owner', (b,a) => { a.functions[0].owner = 'service_role'; }],
  ['changed search path', (b,a) => { a.functions[0].config = ['search_path=public']; }],
  ['preexisting helper', b => { b.functions[4].oid = 104; }],
  ['contradictory absent helper metadata', b => { b.functions[4].securityDefiner = false; }],
  ['missing new helper', (b,a) => { a.functions[4].oid = null; }],
  ['unrelated history mutation', (b,a) => { a.migrations[0].name = 'changed'; }],
  ['different added migration', (b,a) => { a.migrations[146].version = '20261029090001'; }],
  ['missing history entry', (b,a) => { a.migrations.pop(); }],
  ['function dollar delimiter collision', b => { b.functions[0].definition += '\n-- $delivery_recovery$'; }],
  ['history dollar delimiter collision', (b,a) => { b.migrations[0].statements[0] += ' -- $delivery_recovery$'; a.migrations[0].statements[0]=b.migrations[0].statements[0]; }],
]) test('rejects ' + name, () => {
  const {before,after}=snapshots(); change(before,after);
  assert.throws(() => recoverySql(before, after));
});
