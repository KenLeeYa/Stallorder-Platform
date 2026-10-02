alter table public.merchant_applications
  add column draft_version integer not null default 0,
  add constraint merchant_applications_draft_version_nonnegative check (draft_version >= 0);

CREATE OR REPLACE FUNCTION public.expire_stale_merchant_applications()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_count integer;
begin
  with expired as (
    update public.merchant_applications
    set status = 'EXPIRED'::public.merchant_application_status,
        expires_at = now(),
        draft_version = draft_version + 1,
        updated_at = now()
    where (status = 'DRAFT'::public.merchant_application_status and updated_at < now() - interval '30 days')
       or (status = 'NEEDS_INFO'::public.merchant_application_status and updated_at < now() - interval '30 days')
    returning id, applicant_profile_id
  ), notifications as (
    insert into public.merchant_application_notifications (
      application_id, profile_id, type, title, message
    )
    select id, applicant_profile_id, 'MERCHANT_APPLICATION_EXPIRED',
      '商家申請已逾期', '申請因長時間未更新而結束，請聯絡平台管理員確認是否可重新申請。'
    from expired
    returning id
  )
  select count(*)::integer into v_count from expired;
  return v_count;
end;
$function$
;
