-- Forward-only compatibility repair. Preserve historical/granted/UNKNOWN/platform jobs.
CREATE OR REPLACE FUNCTION public.revoke_line_contact_link(p_order_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_link_id uuid;
  v_secret_id uuid;
begin
  select link.id, link.provider_user_secret_reference
    into v_link_id, v_secret_id
  from public.customer_contact_links link
  where link.customer_reference_id = p_order_id
    and link.provider = 'LINE'::public.notification_provider
  for update;
  if v_link_id is null then
    return false;
  end if;

  update public.customer_contact_links
  set consent_status = 'REVOKED'::public.customer_consent_status,
      revoked_at = now(),
      updated_at = now()
  where id = v_link_id;
  update public.notification_jobs j
  set status = 'CANCELLED'::public.notification_job_status,
      outcome = 'SUPPRESSED',
      next_attempt_at = null,
      last_error_code = 'CONSENT_REVOKED',
      updated_at = now()
  where contact_link_id = v_link_id
    and delivery_mode = 'LEGACY'
    and legacy_intent_json is not null
    and status in ('PENDING', 'FAILED')
    and outcome in ('QUEUED', 'RETRY_SCHEDULED')
    and first_request_at is null
    and lease_token is null and lease_expires_at is null
    and not exists (select 1 from public.line_platform_order_owners owner where owner.order_id = j.order_id);
  delete from vault.secrets secret where secret.id = v_secret_id;
  return true;
end;
$function$;
