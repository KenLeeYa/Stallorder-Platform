do $$
declare
  target_table regclass;
begin
  foreach target_table in array array[
    'public.auth_identities'::regclass,
    'public.auth_identity_link_invitations'::regclass,
    'public.delivery_platform_connection_requests'::regclass,
    'public.delivery_platform_connections'::regclass,
    'public.delivery_sync_jobs'::regclass,
    'public.delivery_webhook_events'::regclass,
    'public.external_menu_mappings'::regclass,
    'public.external_orders'::regclass,
    'public.external_store_mappings'::regclass,
    'public.oauth_provider_events'::regclass,
    'public.oauth_transactions'::regclass
  ]
  loop
    perform app_private.install_backend_writable_guard(target_table);
  end loop;
end;
$$;

comment on table public.auth_identities is
  'Cross-provider identity mapping replicated to the fenced DR standby.';
comment on table public.delivery_webhook_events is
  'Idempotent delivery webhook ledger replicated to the fenced DR standby.';
