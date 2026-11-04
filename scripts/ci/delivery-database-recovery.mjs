import assert from 'node:assert/strict';

export const RECOVERY_SIGNATURES = [
  'app_private.issue_order_session_with_schedule_targeted(text,text,text,text,text,text,text,text)',
  'public.create_public_order_legacy(uuid,text,text,text,text,text,text,uuid,text,text,text,jsonb,text,text,text)',
  'public.issue_order_session_with_schedule(text,text,text,text,text,text,text,text)',
  'public.public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamptz,uuid,jsonb,boolean,text)',
  'public.delivery_ordering_unavailable_code(uuid,timestamptz)',
];
const literal = value => "'" + value.replaceAll("'", "''") + "'";
export const SNAPSHOT_SQL = `SELECT jsonb_build_object(
  'principal', (SELECT jsonb_build_object('currentUser',current_user,'sessionUser',session_user,
    'database',current_database(),'superuser',rolsuper,'bypassRls',rolbypassrls)
    FROM pg_catalog.pg_roles WHERE rolname=current_user),
  'functions', (SELECT jsonb_agg(jsonb_build_object('signature',s.signature,'oid',p.oid::bigint,
    'definition',pg_catalog.pg_get_functiondef(p.oid),'owner',pg_catalog.pg_get_userbyid(p.proowner),
    'acl',to_jsonb(p.proacl::text[]),'config',to_jsonb(p.proconfig),'securityDefiner',p.prosecdef)
    ORDER BY s.ordinal)
    FROM unnest(ARRAY[${RECOVERY_SIGNATURES.map(literal).join(',')}]) WITH ORDINALITY AS s(signature,ordinal)
    LEFT JOIN pg_catalog.pg_proc p ON p.oid=pg_catalog.to_regprocedure(s.signature)),
  'migrations', (SELECT jsonb_agg(to_jsonb(m) ORDER BY m.version) FROM supabase_migrations.schema_migrations m)
)`;

// Captured source must be authenticated by the protected caller before this
// builder is used remotely. This module does not connect or authorize a release.
export function validateSnapshots(before, after) {
  const principal = { currentUser:'postgres', sessionUser:'postgres', database:'postgres', superuser:false, bypassRls:true };
  assert.deepEqual(before.principal, principal); assert.deepEqual(after.principal, principal);
  assert.equal(before.functions.length, 5); assert.equal(after.functions.length, 5);
  for (let i=0;i<5;i++) {
    const b=before.functions[i], a=after.functions[i];
    assert.equal(b.signature,RECOVERY_SIGNATURES[i]); assert.equal(a.signature,RECOVERY_SIGNATURES[i]);
    assert.ok(Number.isSafeInteger(a.oid) && a.oid>0);
    assert.equal(a.owner,'postgres'); assert.equal(a.securityDefiner,true);
    assert.deepEqual(a.config,['search_path=""']);
    assert.ok(typeof a.definition==='string' && a.definition.startsWith('CREATE OR REPLACE FUNCTION '));
    if(i<4) {
      assert.ok(Number.isSafeInteger(b.oid) && b.oid>0); assert.equal(a.oid,b.oid);
      assert.equal(b.owner,'postgres'); assert.equal(b.securityDefiner,true);
      assert.deepEqual(b.config,a.config); assert.deepEqual(b.acl,a.acl);
      assert.ok(typeof b.definition==='string' && b.definition.startsWith('CREATE OR REPLACE FUNCTION '));
      assert.notEqual(b.definition,a.definition);
    } else {
      for (const key of ['oid','definition','owner','acl','config','securityDefiner']) assert.equal(b[key],null);
      assert.deepEqual([...a.acl].sort(),['postgres=X/postgres','service_role=X/postgres']);
    }
  }
  assert.equal(before.migrations.length,146); assert.equal(after.migrations.length,147);
  assert.equal(new Set(before.migrations.map(m=>m.version)).size,146);
  assert.deepEqual(after.migrations.slice(0,146),before.migrations);
  assert.equal(after.migrations[146].version,'20261029090000');
  assert.equal(after.migrations[146].name,'public_delivery_ordering_hours');
  assert.ok(Array.isArray(after.migrations[146].statements) && after.migrations[146].statements.length>0);
  return true;
}

export function recoverySql(before, after) {
  validateSnapshots(before,after);
  assert.ok(!JSON.stringify([before,after]).includes('$delivery_recovery$'),'snapshot contains reserved SQL delimiter');
  return `BEGIN;
SET LOCAL standard_conforming_strings = on;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';
SET LOCAL search_path = pg_catalog;
LOCK TABLE supabase_migrations.schema_migrations IN EXCLUSIVE MODE;
DO $delivery_recovery$
DECLARE
  expected_before jsonb := ${literal(JSON.stringify(before))}::jsonb;
  expected_after jsonb := ${literal(JSON.stringify(after))}::jsonb;
  actual jsonb;
  entry jsonb;
  removed integer;
BEGIN
  actual := (${SNAPSHOT_SQL});
  IF actual IS DISTINCT FROM expected_after THEN RAISE EXCEPTION 'DELIVERY_RECOVERY_PREIMAGE_DRIFT'; END IF;
  FOR entry IN SELECT value FROM jsonb_array_elements(expected_before->'functions') LOOP
    IF entry->>'definition' IS NOT NULL THEN EXECUTE entry->>'definition'; END IF;
  END LOOP;
  DROP FUNCTION public.delivery_ordering_unavailable_code(uuid,timestamptz) RESTRICT;
  DELETE FROM supabase_migrations.schema_migrations m
    WHERE m.version='20261029090000' AND to_jsonb(m)=expected_after->'migrations'->146;
  GET DIAGNOSTICS removed = ROW_COUNT;
  IF removed<>1 THEN RAISE EXCEPTION 'DELIVERY_RECOVERY_HISTORY_DRIFT'; END IF;
  actual := (${SNAPSHOT_SQL});
  IF actual IS DISTINCT FROM expected_before THEN RAISE EXCEPTION 'DELIVERY_RECOVERY_POSTIMAGE_MISMATCH'; END IF;
END;
$delivery_recovery$;
COMMIT;
`;
}
