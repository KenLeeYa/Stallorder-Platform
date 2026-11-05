import assert from "node:assert/strict";
import { createHash } from "node:crypto";

type OwnedProbe = { profileId: string; sessionId: string; tokenHash: string };

// DO has no bind parameters. Only canonical UUIDs and a SHA-256 digest enter
// this statement; the email and bucket key are derived here, never caller SQL.
// The caller retains its existing Serializable transaction and default timeout.
export function buildPreviewPrincipalCleanupSql(owned: OwnedProbe) {
  for (const value of [owned.profileId, owned.sessionId]) {
    assert.match(value, /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  }
  assert.match(owned.tokenHash, /^[a-f0-9]{64}$/);
  const bucketKey = createHash("sha256").update(`platform-billing-api:${owned.profileId}`).digest("hex");
  return `DO $owned_cleanup$
DECLARE
  owned_id CONSTANT uuid := '${owned.profileId}';
  session_id CONSTANT uuid := '${owned.sessionId}';
  session_hash CONSTANT text := '${owned.tokenHash}';
  bucket_key CONSTANT text := '${bucketKey}';
  profile_row public.profiles%ROWTYPE;
  fk record;
  found_rows bigint;
  foreign_before jsonb;
  foreign_after jsonb;
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '3s', true);
  SELECT * INTO profile_row FROM public.profiles WHERE id=owned_id FOR UPDATE;
  IF FOUND THEN
    IF profile_row.email IS DISTINCT FROM 'preview-principal-${owned.profileId}@stallorder.invalid'
      OR profile_row.auth_user_id IS NOT NULL THEN
      RAISE EXCEPTION 'OWNED_PROFILE_PREIMAGE_MISMATCH';
    END IF;
    PERFORM 1 FROM public.auth_sessions WHERE id=session_id FOR UPDATE;
    IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c LEFT JOIN pg_catalog.pg_attribute a
      ON a.attrelid=c.confrelid AND a.attnum=c.confkey[1]
      WHERE c.contype='f' AND c.confrelid IN ('public.profiles'::regclass,'public.auth_sessions'::regclass)
        AND (array_length(c.conkey,1) IS DISTINCT FROM 1 OR a.attname IS DISTINCT FROM 'id'))
      OR EXISTS (SELECT 1 FROM pg_catalog.pg_constraint WHERE contype='f'
        AND confrelid IN ('public.audit_logs'::regclass,'public.rate_limit_buckets'::regclass)) THEN
      RAISE EXCEPTION 'UNSUPPORTED_OWNED_REFERENCE';
    END IF;
    FOR fk IN SELECT ns.nspname, cl.relname, a.attname
      FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class cl ON cl.oid=c.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.contype='f' AND c.confrelid='public.auth_sessions'::regclass
    LOOP
      EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I WHERE %I=$1',fk.nspname,fk.relname,fk.attname)
        INTO found_rows USING session_id;
      IF found_rows<>0 THEN RAISE EXCEPTION 'UNEXPECTED_SESSION_REFERENCE'; END IF;
    END LOOP;
    SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.key),'[]'::jsonb) INTO foreign_before
      FROM public.rate_limit_buckets b WHERE b.key<>bucket_key;
    DELETE FROM public.audit_logs WHERE actor_profile_id=owned_id
      AND action='AUTHORIZATION_DENIED' AND entity_type='PLATFORM_BILLING' AND outcome='DENIED';
    DELETE FROM public.rate_limit_buckets WHERE key=bucket_key AND scope='platform-billing-api';
    DELETE FROM public.auth_sessions WHERE id=session_id AND profile_id=owned_id AND token_hash=session_hash;
    -- The profile lock prevents new FK references. All remaining inbound rows
    -- must be absent before deleting it, including future schema additions.
    FOR fk IN SELECT ns.nspname, cl.relname, a.attname
      FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class cl ON cl.oid=c.conrelid
      JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
      JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      WHERE c.contype='f' AND c.confrelid='public.profiles'::regclass
    LOOP
      EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I WHERE %I=$1',fk.nspname,fk.relname,fk.attname)
        INTO found_rows USING owned_id;
      IF found_rows<>0 THEN RAISE EXCEPTION 'UNEXPECTED_PROFILE_REFERENCE'; END IF;
    END LOOP;
    DELETE FROM public.profiles WHERE id=owned_id;
    SELECT coalesce(jsonb_agg(to_jsonb(b) ORDER BY b.key),'[]'::jsonb) INTO foreign_after
      FROM public.rate_limit_buckets b WHERE b.key<>bucket_key;
    IF foreign_before IS DISTINCT FROM foreign_after THEN RAISE EXCEPTION 'FOREIGN_RATE_CHANGED'; END IF;
  END IF;
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id=owned_id)
    OR EXISTS (SELECT 1 FROM public.auth_sessions WHERE profile_id=owned_id OR id=session_id)
    OR EXISTS (SELECT 1 FROM public.audit_logs WHERE actor_profile_id=owned_id)
    OR EXISTS (SELECT 1 FROM public.rate_limit_buckets WHERE key=bucket_key) THEN
    RAISE EXCEPTION 'OWNED_CLEANUP_INCOMPLETE';
  END IF;
END;
$owned_cleanup$;`;
}
