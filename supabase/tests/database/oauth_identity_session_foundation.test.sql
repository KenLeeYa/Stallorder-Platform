begin;

create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select plan(34);

select has_table('public', 'auth_identities', 'OAuth identity ledger exists');
select has_table('public', 'auth_identity_link_invitations', 'identity-link invitation ledger exists');
select has_table('public', 'oauth_transactions', 'OAuth transaction ledger exists');

select is(
  (
    select is_nullable
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'profiles'
      and column_name = 'email'
  ),
  'YES',
  'profile email is optional contact data'
);
select col_not_null('public', 'auth_identities', 'provider_subject', 'provider subject is required');
select has_column('public', 'profiles', 'email_source', 'profile email source is tracked');
select has_column('public', 'auth_sessions', 'rotation_family_id', 'session rotation family is tracked');
select has_column('public', 'auth_sessions', 'revoked_at', 'session revocation is tracked');
select has_column('public', 'auth_sessions', 'profile_session_version', 'session version is tracked');

select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.auth_identities'::regclass
  ),
  'OAuth identities force RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.auth_identity_link_invitations'::regclass
  ),
  'identity-link invitations force RLS'
);
select ok(
  (
    select relrowsecurity and relforcerowsecurity
    from pg_class
    where oid = 'public.oauth_transactions'::regclass
  ),
  'OAuth transactions force RLS'
);
select ok(
  not has_table_privilege('anon', 'public.auth_identities', 'SELECT'),
  'anonymous users cannot read OAuth identities'
);
select ok(
  not has_table_privilege('authenticated', 'public.auth_identity_link_invitations', 'SELECT'),
  'authenticated Data API users cannot read identity-link invitations'
);
select ok(
  not has_table_privilege('authenticated', 'public.oauth_transactions', 'SELECT'),
  'authenticated Data API users cannot read OAuth transactions'
);
select ok(
  has_table_privilege('service_role', 'public.auth_identities', 'INSERT'),
  'service role can create verified OAuth identities'
);
select is(
  (
    select count(*)::integer
    from information_schema.columns
    where table_schema = 'public'
      and table_name in ('auth_identities', 'oauth_transactions')
      and column_name in (
        'access_token',
        'refresh_token',
        'authorization_code',
        'id_token',
        'client_secret',
        'private_key'
      )
  ),
  0,
  'OAuth ledgers have no raw credential columns'
);

select lives_ok(
  $$
    insert into public.profiles (
      id,
      email,
      password_hash,
      display_name,
      updated_at
    )
    values (
      '99000000-0000-4000-8000-000000000001',
      null,
      null,
      'OAuth pgTAP profile',
      now()
    )
  $$,
  'a profile without email is valid'
);

select lives_ok(
  $$
    insert into public.auth_identities (
      id,
      profile_id,
      provider,
      provider_subject,
      provider_metadata
    )
    values (
      '99000000-0000-4000-8000-000000000002',
      '99000000-0000-4000-8000-000000000001',
      'GOOGLE',
      'google-subject-1',
      '{"locale":"zh-TW"}'::jsonb
    )
  $$,
  'verified provider subject can be recorded'
);

select throws_ok(
  $$
    insert into public.auth_identities (
      profile_id,
      provider,
      provider_subject
    )
    values (
      '99000000-0000-4000-8000-000000000001',
      'GOOGLE',
      'google-subject-1'
    )
  $$,
  '23505',
  null,
  'the same provider subject cannot be linked twice'
);

select throws_ok(
  $$
    insert into public.auth_identities (
      profile_id,
      provider,
      provider_subject
    )
    values (
      '99000000-0000-4000-8000-000000000001',
      'GOOGLE',
      'google-subject-2'
    )
  $$,
  '23505',
  null,
  'a profile cannot have two identities for one provider'
);

select throws_ok(
  $$
    insert into public.auth_identities (
      profile_id,
      provider,
      provider_subject
    )
    values (
      '99000000-0000-4000-8000-000000000001',
      'PASSWORD',
      'local-subject'
    )
  $$,
  '23514',
  null,
  'local password is not an OAuth identity provider'
);

select throws_ok(
  $$
    insert into public.auth_identities (
      profile_id,
      provider,
      provider_subject,
      provider_metadata
    )
    values (
      '99000000-0000-4000-8000-000000000001',
      'LINE',
      'line-subject-sensitive',
      '{"access_token":"must-not-persist"}'::jsonb
    )
  $$,
  '23514',
  null,
  'sensitive OAuth token keys are rejected from provider metadata'
);

select lives_ok(
  $$
    insert into public.auth_identity_link_invitations (
      id,
      profile_id,
      allowed_providers,
      token_hash,
      created_by_profile_id,
      expires_at
    )
    values (
      '99000000-0000-4000-8000-000000000003',
      '99000000-0000-4000-8000-000000000001',
      array['LINE', 'APPLE'],
      repeat('c', 64),
      '99000000-0000-4000-8000-000000000001',
      now() + interval '10 minutes'
    )
  $$,
  'a hashed short-lived identity-link invitation can be created'
);

select throws_ok(
  $$
    insert into public.auth_identity_link_invitations (
      profile_id,
      allowed_providers,
      token_hash,
      created_by_profile_id,
      expires_at
    )
    values (
      '99000000-0000-4000-8000-000000000001',
      array['GOOGLE'],
      'raw-token',
      '99000000-0000-4000-8000-000000000001',
      now() + interval '10 minutes'
    )
  $$,
  '23514',
  null,
  'identity-link invitation tokens must be stored as hashes'
);

select lives_ok(
  $$
    insert into public.oauth_transactions (
      id,
      provider,
      state_hash,
      nonce_hash,
      code_verifier_ciphertext,
      redirect_uri,
      return_to,
      expires_at
    )
    values (
      '99000000-0000-4000-8000-000000000004',
      'LINE',
      repeat('a', 64),
      repeat('b', 64),
      repeat('x', 32),
      'https://preview.example.test/api/auth/line/callback',
      '/merchant/dashboard',
      now() + interval '10 minutes'
    )
  $$,
  'a short-lived server-side OAuth transaction can be created'
);

select throws_ok(
  $$
    insert into public.oauth_transactions (
      provider,
      state_hash,
      nonce_hash,
      code_verifier_ciphertext,
      redirect_uri,
      expires_at
    )
    values (
      'LINE',
      repeat('a', 64),
      repeat('d', 64),
      repeat('y', 32),
      'https://preview.example.test/api/auth/line/callback',
      now() + interval '10 minutes'
    )
  $$,
  '23505',
  null,
  'OAuth state cannot be replayed'
);

select throws_ok(
  $$
    insert into public.oauth_transactions (
      provider,
      state_hash,
      nonce_hash,
      code_verifier_ciphertext,
      redirect_uri,
      return_to,
      expires_at
    )
    values (
      'APPLE',
      repeat('e', 64),
      repeat('f', 64),
      repeat('z', 32),
      'https://preview.example.test/api/auth/apple/callback',
      '//attacker.example',
      now() + interval '10 minutes'
    )
  $$,
  '23514',
  null,
  'protocol-relative OAuth return paths are rejected'
);

select lives_ok(
  $$
    insert into public.auth_sessions (
      id,
      profile_id,
      token_hash,
      csrf_token_hash,
      ip_hash,
      user_agent_hash,
      expires_at
    )
    values (
      '99000000-0000-4000-8000-000000000005',
      '99000000-0000-4000-8000-000000000001',
      repeat('1', 64),
      repeat('2', 64),
      repeat('3', 64),
      repeat('4', 64),
      now() + interval '8 hours'
    )
  $$,
  'a hashed revocable session can be created'
);

select is(
  (
    select profile_session_version
    from public.auth_sessions
    where id = '99000000-0000-4000-8000-000000000005'
  ),
  1,
  'new sessions start with the current profile session version'
);

select ok(
  (
    select rotation_family_id is not null
    from public.auth_sessions
    where id = '99000000-0000-4000-8000-000000000005'
  ),
  'new sessions receive a rotation family'
);

select throws_ok(
  $$
    update public.auth_sessions
    set ip_hash = 'raw-ip-address'
    where id = '99000000-0000-4000-8000-000000000005'
  $$,
  '23514',
  null,
  'raw client network identifiers are rejected'
);

select lives_ok(
  $$
    update public.auth_sessions
    set revoked_at = now(),
        revoke_reason = 'LOGOUT'
    where id = '99000000-0000-4000-8000-000000000005'
  $$,
  'a session can be explicitly revoked'
);

select is(
  (
    select revoke_reason
    from public.auth_sessions
    where id = '99000000-0000-4000-8000-000000000005'
  ),
  'LOGOUT',
  'session revocation reason is retained'
);

select * from finish();
rollback;
