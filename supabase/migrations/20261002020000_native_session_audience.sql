-- Expand the existing session authority; existing sessions remain WEB.
CREATE TYPE public."AuthSessionClientKind" AS ENUM ('WEB', 'NATIVE');
ALTER TABLE public.auth_sessions ADD COLUMN client_kind public."AuthSessionClientKind" NOT NULL DEFAULT 'WEB';
-- Existing table grants/RLS remain unchanged. No parallel identity or token table.
-- Native capabilities remain disabled by server defaults. Register flags only
-- through the separately reviewed Primary pilot fixture; schema Apply never writes
-- replicated feature flag rows independently on Primary and DR.
