alter table public.printers
  add column if not exists device_id text,
  add column if not exists device_token_hash text,
  add column if not exists credential_version integer not null default 0,
  add column if not exists credential_rotated_at timestamptz;

alter table public.printers
  add constraint printers_cloudprnt_device_id_check check (
    device_id is null or device_id ~ '^PRN_[A-Za-z0-9_-]{16}$'
  ),
  add constraint printers_cloudprnt_token_hash_check check (
    device_token_hash is null or device_token_hash ~ '^[0-9a-f]{64}$'
  ),
  add constraint printers_cloudprnt_credential_pair_check check (
    (device_id is null and device_token_hash is null and credential_version = 0)
    or (device_id is not null and device_token_hash is not null and credential_version >= 1)
  );

create unique index if not exists printers_device_id_key
  on public.printers (device_id);

comment on column public.printers.device_id is
  'Non-secret CloudPRNT device identity used in the stable per-printer Server URL.';
comment on column public.printers.device_token_hash is
  'SHA-256 hash of the one-time CloudPRNT device password; the raw password is never stored.';
comment on column public.printers.credential_version is
  'Monotonic CloudPRNT credential generation used for rotation auditing.';
comment on column public.printers.credential_rotated_at is
  'Most recent time the CloudPRNT device password was generated or rotated.';
