do $line_preview$
begin
  if (
    select count(*)
    from public.resilience_feature_flags
    where code in ('OAUTH_IDENTITY_FOUNDATION_ENABLED', 'OAUTH_LINE_ENABLED')
  ) <> 2 then
    raise exception 'LINE Preview OAuth feature flags are missing';
  end if;
end
$line_preview$;

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
  'Ephemeral synthetic Preview validation only'
from public.resilience_feature_flags flag
where flag.code in ('OAUTH_IDENTITY_FOUNDATION_ENABLED', 'OAUTH_LINE_ENABLED');
