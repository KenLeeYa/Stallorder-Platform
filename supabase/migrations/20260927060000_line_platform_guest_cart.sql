-- Bind an original guest session's explicit cart handoff to one platform member.
alter table public.order_sessions
  add column line_platform_cart_claim_profile_id uuid references public.line_platform_members(profile_id),
  add column line_platform_cart_claimed_at timestamptz,
  add constraint order_sessions_line_cart_claim_pair check
    ((line_platform_cart_claim_profile_id is null) = (line_platform_cart_claimed_at is null));

create function app_private.enforce_line_platform_cart_claim()
returns trigger language plpgsql set search_path = '' as $$
begin
  if (tg_op = 'INSERT' and new.line_platform_cart_claim_profile_id is not null)
    or (tg_op = 'UPDATE' and (new.line_platform_cart_claim_profile_id is distinct from old.line_platform_cart_claim_profile_id
      or new.line_platform_cart_claimed_at is distinct from old.line_platform_cart_claimed_at)) then
    if current_user not in ('postgres','supabase_admin','service_role') then
      raise exception 'LINE_CART_CLAIM_SERVER_ONLY';
    end if;
    if tg_op = 'UPDATE' and old.line_platform_cart_claim_profile_id is not null then
      raise exception 'LINE_CART_CLAIM_IMMUTABLE';
    end if;
    if new.line_platform_cart_claim_profile_id is not null and
      (new.status <> 'ACTIVE' or new.revoked_at is not null or new.order_id is not null or new.expires_at <= now()) then
      raise exception 'LINE_CART_SESSION_UNAVAILABLE';
    end if;
  end if;
  return new;
end;
$$;
create trigger order_sessions_line_platform_cart_claim
before insert or update on public.order_sessions
for each row execute function app_private.enforce_line_platform_cart_claim();
revoke insert (line_platform_cart_claim_profile_id,line_platform_cart_claimed_at),
  update (line_platform_cart_claim_profile_id,line_platform_cart_claimed_at) on public.order_sessions from anon,authenticated;
