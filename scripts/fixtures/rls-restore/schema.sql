-- Synthetic role model. Existing application policies/migrations are never altered.
\set ON_ERROR_STOP on
REVOKE ALL ON DATABASE pr366_rls FROM PUBLIC;
GRANT CONNECT ON DATABASE pr366_rls TO pr366_runner, pr366_observer, pr366_tenant_a, pr366_tenant_b;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO pr366_owner, pr366_runner, pr366_observer, pr366_tenant_a, pr366_tenant_b;
CREATE TABLE public.pr366_catalog (
  id integer PRIMARY KEY,
  tenant name NOT NULL,
  name text NOT NULL,
  image_key text NOT NULL
);
INSERT INTO public.pr366_catalog VALUES
  (1, 'pr366_tenant_a', '合成商品', 'synthetic/catalog/pixel.png'),
  (2, 'pr366_tenant_b', 'Other synthetic item', 'synthetic/資料/binary.bin');
ALTER TABLE public.pr366_catalog OWNER TO pr366_owner;
ALTER TABLE public.pr366_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pr366_catalog FORCE ROW LEVEL SECURITY;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.pr366_catalog TO pr366_runner, pr366_tenant_a, pr366_tenant_b;
GRANT SELECT ON public.pr366_catalog TO pr366_observer;
CREATE POLICY tenant_rows ON public.pr366_catalog TO pr366_tenant_a, pr366_tenant_b
  USING (tenant = session_user) WITH CHECK (tenant = session_user);
-- All-row fixture access belongs only to the synthetic harness roles.
-- It is not a model for a tenant-facing application's authorization policy.
CREATE POLICY fixture_runner ON public.pr366_catalog TO pr366_runner USING (true) WITH CHECK (true);
CREATE POLICY fixture_observer ON public.pr366_catalog FOR SELECT TO pr366_observer USING (true);
