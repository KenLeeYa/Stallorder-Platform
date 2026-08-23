-- Local CI only: exercise the guarded legacy Google migration path without
-- configuring or enabling any direct OAuth provider credentials.
do $local_e2e_fixture$
begin
  delete from public.resilience_feature_flag_overrides override
  using public.resilience_feature_flags flag
  where override.flag_id = flag.id
    and override.scope_type = 'GLOBAL'
    and flag.code in (
      'OAUTH_IDENTITY_FOUNDATION_ENABLED',
      'OAUTH_GOOGLE_ENABLED'
    );

  insert into public.resilience_feature_flag_overrides (
    flag_id,
    scope_type,
    enabled,
    reason
  )
  select
    flag.id,
    'GLOBAL',
    true,
    'Local CI legacy Google OAuth compatibility only'
  from public.resilience_feature_flags flag
  where flag.code in (
    'OAUTH_IDENTITY_FOUNDATION_ENABLED',
    'OAUTH_GOOGLE_ENABLED'
  );
end
$local_e2e_fixture$;
