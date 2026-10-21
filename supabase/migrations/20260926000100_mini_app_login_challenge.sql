-- Reuse the existing one-use login/session lifecycle, while keeping LIFF ID-token
-- exchange separate from OAuth authorization-code callbacks and identity linking.
alter table public.oauth_transactions
  add column flow text not null default 'OAUTH'
    check (flow in ('OAUTH', 'LINE_MINIAPP')),
  add column context_fingerprint text
    check (context_fingerprint is null or context_fingerprint ~ '^[a-f0-9]{64}$'),
  add constraint oauth_transactions_mini_app_context check (
    flow <> 'LINE_MINIAPP' or (
      provider = 'LINE' and not link_mode
      and current_profile_id is null and invitation_id is null
      and context_fingerprint is not null
    )
  );

comment on column public.oauth_transactions.flow is
  'OAUTH: authorization-code callback; LINE_MINIAPP: browser-bound raw ID-token exchange. Both create the existing auth session.';
