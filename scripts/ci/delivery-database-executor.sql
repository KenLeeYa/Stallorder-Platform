-- Run only through the protected collector with the reviewed migration connection.
-- A single fresh read-only statement; no role switching, DDL, or customer rows.
WITH targets(signature) AS (VALUES
  ('app_private.issue_order_session_with_schedule_targeted(text,text,text,text,text,text,text,text)'),
  ('create_public_order_legacy(uuid,text,text,text,text,text,text,uuid,text,text,text,jsonb,text,text,text)'),
  ('issue_order_session_with_schedule(text,text,text,text,text,text,text,text)'),
  ('public_order_preflight(text,text,text,text,text,text,text,text,text,uuid,text,timestamp with time zone,uuid,jsonb,boolean,text)')
), functions AS (
  SELECT t.signature, p.oid, p.proacl, p.proowner
  FROM targets t LEFT JOIN pg_proc p ON p.oid = to_regprocedure(t.signature)
)
SELECT jsonb_build_object(
  'schema', 'stallorder-delivery-executor/v1',
  'proofType', 'migration-connection-query',
  'observedAt', to_char(statement_timestamp() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'currentUser', current_user, 'sessionUser', session_user,
  'database', current_database(), 'backendPid', pg_backend_pid(),
  'serverVersionNum', current_setting('server_version_num')::integer,
  'superuser', r.rolsuper, 'bypassRls', r.rolbypassrls,
  'transactionReadOnly', current_setting('transaction_read_only')::boolean,
  'createPublic', has_schema_privilege(current_user, 'public', 'CREATE'),
  'helperExists', to_regprocedure('public.delivery_ordering_unavailable_code(uuid,timestamptz)') IS NOT NULL,
  'functions', (SELECT jsonb_agg(jsonb_build_object(
    'signature', f.signature,
    'definitionSha256', encode(sha256(convert_to(pg_get_functiondef(f.oid), 'UTF8')), 'hex'),
    'owner', pg_get_userbyid(f.proowner),
    'acl', to_jsonb(f.proacl::text[]),
    'executorExecute', has_function_privilege(current_user, f.oid, 'EXECUTE')
  ) ORDER BY f.signature) FROM functions f)
) FROM pg_roles r WHERE r.rolname = current_user;
