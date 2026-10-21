BEGIN;
ALTER TABLE public.staff_push_deliveries
  ADD CONSTRAINT staff_push_delivery_id_order_key UNIQUE (id, order_id);

CREATE TABLE public.notification_read_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  billing_notification_id uuid REFERENCES public.billing_notifications(id) ON DELETE CASCADE,
  application_notification_id uuid REFERENCES public.merchant_application_notifications(id) ON DELETE CASCADE,
  staff_delivery_id uuid,
  staff_order_id uuid REFERENCES public.orders(id) ON DELETE CASCADE,
  read_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT notification_receipt_source_xor CHECK (
    (billing_notification_id IS NOT NULL AND application_notification_id IS NULL AND staff_delivery_id IS NULL AND staff_order_id IS NULL)
    OR (billing_notification_id IS NULL AND application_notification_id IS NOT NULL AND staff_delivery_id IS NULL AND staff_order_id IS NULL)
    OR (billing_notification_id IS NULL AND application_notification_id IS NULL AND staff_delivery_id IS NOT NULL AND staff_order_id IS NOT NULL)
  ),
  CONSTRAINT notification_receipt_staff_source_fk FOREIGN KEY (staff_delivery_id,staff_order_id)
    REFERENCES public.staff_push_deliveries(id,order_id) ON DELETE CASCADE,
  CONSTRAINT notification_receipt_profile_billing_key UNIQUE(profile_id,billing_notification_id),
  CONSTRAINT notification_receipt_profile_application_key UNIQUE(profile_id,application_notification_id),
  CONSTRAINT notification_receipt_profile_order_key UNIQUE(profile_id,staff_order_id)
);
CREATE INDEX notification_receipt_profile_read_idx ON public.notification_read_receipts(profile_id,read_at DESC);
CREATE TABLE public.notification_preferences (
  profile_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  billing_visible boolean NOT NULL DEFAULT true,
  application_visible boolean NOT NULL DEFAULT true,
  staff_order_visible boolean NOT NULL DEFAULT true,
  analytics_consent boolean NOT NULL DEFAULT false,
  version integer NOT NULL DEFAULT 1 CHECK(version > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.notification_read_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_read_receipts FORCE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.notification_read_receipts,public.notification_preferences FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT,UPDATE ON public.notification_read_receipts,public.notification_preferences TO service_role;
CREATE TRIGGER backend_writable_guard BEFORE INSERT OR UPDATE OR DELETE ON public.notification_read_receipts
  FOR EACH STATEMENT EXECUTE FUNCTION app_private.enforce_backend_writable();
CREATE TRIGGER backend_writable_guard BEFORE INSERT OR UPDATE OR DELETE ON public.notification_preferences
  FOR EACH STATEMENT EXECUTE FUNCTION app_private.enforce_backend_writable();
-- Replicated-data backfill is Primary-only after schema Apply; never run on DR.
-- Execute supabase/fixtures/primary_notification_read_receipts_backfill.sql
-- and verify zero missing legacy receipts before exposing the new inbox.
COMMIT;
