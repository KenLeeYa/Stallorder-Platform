import assert from 'node:assert/strict';

export function oldAppCleanupAllowed({browserStopped,pendingRequests,unknownRequest,databaseWritePending}) {
 return browserStopped===true&&pendingRequests===0&&unknownRequest===false&&databaseWritePending===false;
}

// The caller supplies a UUID allocated before creating this run's synthetic user.
// Reject unknown inbound references before deleting the profile or its sessions.
export function oldAppProfileCleanupSql(id) {
 assert.match(id??'',/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
 return `DO $rotation_cleanup$
DECLARE
 owned_id CONSTANT uuid := '${id}';
 fk record;
 found_rows bigint;
BEGIN
 PERFORM pg_catalog.set_config('lock_timeout','3s',true);
 PERFORM 1 FROM public.profiles WHERE id=owned_id FOR UPDATE;
 IF FOUND THEN
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id=owned_id AND
    (email IS DISTINCT FROM 'preview-rotation-${id}@stallorder.invalid' OR auth_user_id IS NOT NULL)) THEN
   RAISE EXCEPTION 'OWNED_PROFILE_PREIMAGE_MISMATCH';
  END IF;
  PERFORM 1 FROM public.auth_sessions WHERE profile_id=owned_id FOR UPDATE;
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c LEFT JOIN pg_catalog.pg_attribute a
   ON a.attrelid=c.confrelid AND a.attnum=c.confkey[1] WHERE c.contype='f'
   AND c.confrelid IN ('public.profiles'::regclass,'public.auth_sessions'::regclass)
   AND (array_length(c.conkey,1) IS DISTINCT FROM 1 OR a.attname IS DISTINCT FROM 'id')) THEN
   RAISE EXCEPTION 'UNSUPPORTED_OWNED_REFERENCE';
  END IF;
  FOR fk IN SELECT ns.nspname,cl.relname,a.attname FROM pg_catalog.pg_constraint c
   JOIN pg_catalog.pg_class cl ON cl.oid=c.conrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
   WHERE c.contype='f' AND c.confrelid='public.auth_sessions'::regclass
  LOOP
   IF fk.nspname='public' AND fk.relname='auth_sessions' AND fk.attname='rotated_from_id' THEN
    SELECT count(*) INTO found_rows FROM public.auth_sessions WHERE profile_id<>owned_id
      AND rotated_from_id IN (SELECT id FROM public.auth_sessions WHERE profile_id=owned_id);
   ELSE
    EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I WHERE %I IN (SELECT id FROM public.auth_sessions WHERE profile_id=$1)',fk.nspname,fk.relname,fk.attname)
     INTO found_rows USING owned_id;
   END IF;
   IF found_rows<>0 THEN RAISE EXCEPTION 'UNEXPECTED_SESSION_REFERENCE'; END IF;
  END LOOP;
  DELETE FROM public.audit_logs WHERE actor_profile_id=owned_id AND entity_type='AUTH'
   AND action IN ('LOGIN_SUCCESS','LOGIN_FAILURE','LOGIN_FAILURE_BUCKET_RESET_FAILED','RATE_LIMIT_HIT');
  DELETE FROM public.auth_sessions WHERE profile_id=owned_id;
  DELETE FROM public.organization_memberships WHERE profile_id=owned_id
   AND organization_id='11111111-1111-4111-8111-111111111111' AND role='ORGANIZATION_OWNER' AND is_primary_owner=false;
  DELETE FROM public.stall_memberships WHERE profile_id=owned_id
   AND organization_id='11111111-1111-4111-8111-111111111111' AND stall_id='22222222-2222-4222-8222-222222222222' AND role='STAFF';
  FOR fk IN SELECT ns.nspname,cl.relname,a.attname FROM pg_catalog.pg_constraint c
   JOIN pg_catalog.pg_class cl ON cl.oid=c.conrelid JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
   JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
   WHERE c.contype='f' AND c.confrelid='public.profiles'::regclass
  LOOP
   EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I WHERE %I=$1',fk.nspname,fk.relname,fk.attname)
    INTO found_rows USING owned_id;
   IF found_rows<>0 THEN RAISE EXCEPTION 'UNEXPECTED_PROFILE_REFERENCE'; END IF;
  END LOOP;
  DELETE FROM public.profiles WHERE id=owned_id;
 END IF;
 IF EXISTS (SELECT 1 FROM public.profiles WHERE id=owned_id)
  OR EXISTS (SELECT 1 FROM public.auth_sessions WHERE profile_id=owned_id)
  OR EXISTS (SELECT 1 FROM public.audit_logs WHERE actor_profile_id=owned_id) THEN
  RAISE EXCEPTION 'OWNED_CLEANUP_INCOMPLETE';
 END IF;
END;
$rotation_cleanup$;`;
}

export function oldAppOrderCleanupSql({qrId,orderId,note}) {
 const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
 assert.match(qrId??'',uuid);if(orderId!==undefined)assert.match(orderId,uuid);
 assert.match(note??'',/^Credential rehearsal [1-9][0-9]* [a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
 return `DO $qr_cleanup$
DECLARE
 qr_id CONSTANT uuid := '${qrId}';
 owned_order CONSTANT uuid := ${orderId?"'"+orderId+"'":'NULL'};
 org CONSTANT uuid := '11111111-1111-4111-8111-111111111111';
 stall CONSTANT uuid := '22222222-2222-4222-8222-222222222222';
 fk record;
 targets text;
 found_rows bigint;
BEGIN
 PERFORM pg_catalog.set_config('lock_timeout','3s',true);
 PERFORM 1 FROM public.qr_codes WHERE id=qr_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.qr_codes WHERE id=qr_id AND
  (organization_id<>org OR stall_id<>stall OR token<>'preview-rotation-${qrId}')) THEN
  RAISE EXCEPTION 'OWNED_QR_PREIMAGE_MISMATCH';
 END IF;
 PERFORM 1 FROM public.orders WHERE id=owned_order FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.orders o WHERE o.id=owned_order AND
  (o.organization_id<>org OR o.stall_id<>stall OR o.note IS DISTINCT FROM '${note}' OR o.source<>'QR_MENU' OR o.stock_consumed)) THEN
  RAISE EXCEPTION 'OWNED_ORDER_PREIMAGE_MISMATCH';
 END IF;
 PERFORM 1 FROM public.order_sessions s WHERE s.qr_code_id=qr_id FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.order_sessions s WHERE s.qr_code_id=qr_id AND
  (s.organization_id<>org OR s.stall_id<>stall OR s.ordering_mode<>'DEFAULT' OR (s.order_id IS NOT NULL AND s.order_id IS DISTINCT FROM owned_order))) THEN
  RAISE EXCEPTION 'OWNED_SESSION_PREIMAGE_MISMATCH';
 END IF;
 IF EXISTS (SELECT 1 FROM public.order_sessions s WHERE s.order_id=owned_order AND s.qr_code_id<>qr_id) THEN
  RAISE EXCEPTION 'FOREIGN_ORDER_SESSION';
 END IF;
 IF EXISTS (SELECT 1 FROM public.public_order_attempts a WHERE
  (a.qr_code_id=qr_id OR a.order_session_id IN (SELECT id FROM public.order_sessions WHERE qr_code_id=qr_id)) AND
  (a.organization_id IS DISTINCT FROM org OR a.stall_id IS DISTINCT FROM stall
   OR (a.qr_code_id IS NOT NULL AND a.qr_code_id<>qr_id)
   OR (a.order_session_id IS NOT NULL AND a.order_session_id NOT IN (SELECT id FROM public.order_sessions WHERE qr_code_id=qr_id)))) THEN
  RAISE EXCEPTION 'FOREIGN_ORDER_ATTEMPT';
 END IF;
 -- Lock each known child before inspecting incoming references to it.
 PERFORM 1 FROM public.order_items i WHERE i.order_id=owned_order FOR UPDATE;
 PERFORM 1 FROM public.order_events e WHERE e.order_id=owned_order FOR UPDATE;
 IF EXISTS (SELECT 1 FROM public.order_items i WHERE i.order_id=owned_order AND (i.organization_id<>org OR i.stall_id<>stall))
  OR EXISTS (SELECT 1 FROM public.order_events e WHERE e.order_id=owned_order AND (e.organization_id<>org OR e.stall_id<>stall)) THEN
  RAISE EXCEPTION 'FOREIGN_ORDER_CHILD';
 END IF;
 FOR fk IN SELECT ns.nspname,cl.relname,a.attname,pc.relname AS parent,
  array_length(c.conkey,1) AS width,pa.attname AS parent_column,j.join_condition
  FROM pg_catalog.pg_constraint c JOIN pg_catalog.pg_class cl ON cl.oid=c.conrelid
  JOIN pg_catalog.pg_namespace ns ON ns.oid=cl.relnamespace
  JOIN pg_catalog.pg_class pc ON pc.oid=c.confrelid
  JOIN pg_catalog.pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
  JOIN pg_catalog.pg_attribute pa ON pa.attrelid=c.confrelid AND pa.attnum=c.confkey[1]
  JOIN LATERAL (SELECT string_agg(pg_catalog.format('child.%I=parent.%I',ca.attname,ta.attname),' AND ' ORDER BY k.n) AS join_condition
   FROM unnest(c.conkey,c.confkey) WITH ORDINALITY k(src,dst,n)
   JOIN pg_catalog.pg_attribute ca ON ca.attrelid=c.conrelid AND ca.attnum=k.src
   JOIN pg_catalog.pg_attribute ta ON ta.attrelid=c.confrelid AND ta.attnum=k.dst) j ON true
  WHERE c.contype='f' AND c.confrelid IN ('public.orders'::regclass,'public.order_sessions'::regclass,
   'public.qr_codes'::regclass,'public.order_items'::regclass,'public.order_events'::regclass)
 LOOP
  targets := CASE fk.parent
   WHEN 'orders' THEN 'SELECT $1::uuid'
   WHEN 'qr_codes' THEN 'SELECT $2::uuid'
   WHEN 'order_sessions' THEN 'SELECT id FROM public.order_sessions WHERE qr_code_id=$2'
   WHEN 'order_items' THEN 'SELECT id FROM public.order_items WHERE order_id=$1'
   WHEN 'order_events' THEN 'SELECT id FROM public.order_events WHERE order_id=$1' END;
  IF fk.width=1 AND fk.parent_column='id' AND fk.nspname='public' AND ((fk.parent='orders' AND fk.relname IN ('order_items','order_events','order_sessions') AND fk.attname='order_id')
    OR (fk.parent='qr_codes' AND fk.relname IN ('order_sessions','public_order_attempts') AND fk.attname='qr_code_id')
    OR (fk.parent='order_sessions' AND fk.relname='public_order_attempts' AND fk.attname='order_session_id')) THEN CONTINUE; END IF;
  EXECUTE pg_catalog.format('SELECT count(*) FROM %I.%I child JOIN public.%I parent ON %s WHERE parent.id IN (%s)',fk.nspname,fk.relname,fk.parent,fk.join_condition,targets)
   INTO found_rows USING owned_order,qr_id;
  IF found_rows<>0 THEN RAISE EXCEPTION 'UNEXPECTED_QR_REFERENCE'; END IF;
 END LOOP;
 DELETE FROM public.public_order_attempts a WHERE a.qr_code_id=qr_id
  OR a.order_session_id IN (SELECT id FROM public.order_sessions WHERE qr_code_id=qr_id);
 DELETE FROM public.order_sessions WHERE qr_code_id=qr_id;
 DELETE FROM public.audit_logs a WHERE a.entity_id=owned_order AND a.organization_id=org AND a.stall_id=stall
  AND a.entity_type='ORDER' AND a.action='PUBLIC_ORDER_CREATED' AND a.actor_profile_id IS NULL;
 DELETE FROM public.order_events e WHERE e.order_id=owned_order;
 DELETE FROM public.order_items i WHERE i.order_id=owned_order;
 DELETE FROM public.orders WHERE id=owned_order;
 DELETE FROM public.qr_codes WHERE id=qr_id;
 IF EXISTS (SELECT 1 FROM public.orders WHERE id=owned_order)
  OR EXISTS (SELECT 1 FROM public.qr_codes WHERE id=qr_id)
  OR EXISTS (SELECT 1 FROM public.order_sessions WHERE qr_code_id=qr_id)
  OR EXISTS (SELECT 1 FROM public.public_order_attempts WHERE qr_code_id=qr_id)
  OR EXISTS (SELECT 1 FROM public.audit_logs WHERE entity_id=owned_order) THEN
  RAISE EXCEPTION 'OWNED_QR_CLEANUP_INCOMPLETE';
 END IF;
END;
$qr_cleanup$;`;
}
