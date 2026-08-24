alter table public.auth_sessions
  add column if not exists device_label varchar(120);

alter table public.auth_sessions
  drop constraint if exists auth_sessions_device_label_check;

alter table public.auth_sessions
  add constraint auth_sessions_device_label_check
  check (device_label is null or char_length(btrim(device_label)) between 1 and 120);

insert into public.resilience_feature_flags (
  code,
  description,
  default_enabled,
  is_emergency
)
values (
  'PAYMENTS_ADMIN_UI_ENABLED',
  '平台管理員付款審核與付款 Provider 介面曝光開關；不會啟用任何收款能力。',
  false,
  false
)
on conflict (code) do update
set
  description = excluded.description,
  default_enabled = false,
  is_emergency = false,
  updated_at = now();

comment on column public.auth_sessions.device_label is
  'Sanitized browser-derived device family and browser label. Never stores the raw user agent or an asserted exact hardware model.';
