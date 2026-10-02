-- Primary-only, after personal_notification_inbox schema Apply and before inbox rollout.
-- The release operator must independently verify the actual Primary project/connection.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '2min';
DO $$
BEGIN
  PERFORM 1 FROM public.backend_runtime_state
    WHERE is_current AND backend_code = 'PRIMARY'
      AND backend_role = 'ACTIVE_WRITER' AND writes_enabled AND enforcement_enabled
    FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PRIMARY_NOTIFICATION_BACKFILL_TARGET_DENIED' USING ERRCODE = '55000';
  END IF;
  PERFORM app_private.assert_backend_writable();
END;
$$;
INSERT INTO public.notification_read_receipts(profile_id,application_notification_id,read_at)
SELECT profile_id,id,read_at FROM public.merchant_application_notifications WHERE read_at IS NOT NULL
ON CONFLICT(profile_id,application_notification_id) DO NOTHING;
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.merchant_application_notifications legacy
    WHERE legacy.read_at IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.notification_read_receipts receipt
      WHERE receipt.profile_id = legacy.profile_id AND receipt.application_notification_id = legacy.id
    )
  ) THEN
    RAISE EXCEPTION 'PRIMARY_NOTIFICATION_BACKFILL_INCOMPLETE';
  END IF;
END;
$$;
COMMIT;
-- Read back zero; preserve existing receipts and their read_at on reruns.
SELECT count(*) AS missing_legacy_read_receipts
FROM public.merchant_application_notifications legacy
WHERE legacy.read_at IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM public.notification_read_receipts receipt
  WHERE receipt.profile_id = legacy.profile_id AND receipt.application_notification_id = legacy.id
);
