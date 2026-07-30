insert into public.resilience_feature_flags (
  code,
  description,
  default_enabled,
  is_emergency
)
values
  (
    'OAUTH_IDENTITY_FOUNDATION_ENABLED',
    'Enables the provider-subject OAuth transaction and callback foundation.',
    false,
    false
  ),
  (
    'OAUTH_GOOGLE_ENABLED',
    'Enables direct Google OpenID Connect sign-in.',
    false,
    false
  ),
  (
    'OAUTH_LINE_ENABLED',
    'Enables direct LINE Login OpenID Connect sign-in.',
    false,
    false
  ),
  (
    'OAUTH_APPLE_ENABLED',
    'Enables Sign in with Apple for the web.',
    false,
    false
  ),
  (
    'OAUTH_ONLY_LOGIN_UI_ENABLED',
    'Hides the legacy local-password login UI after migration gates pass.',
    false,
    false
  ),
  (
    'OAUTH_IDENTITY_LINKING_ENABLED',
    'Enables explicit signed-in and invitation-based provider identity linking.',
    false,
    false
  ),
  (
    'OAUTH_MOCK_PROVIDER_ENABLED',
    'Enables synthetic Mock OIDC only outside Production.',
    false,
    false
  )
on conflict (code) do update
set
  description = excluded.description,
  default_enabled = excluded.default_enabled,
  is_emergency = excluded.is_emergency,
  updated_at = now();
