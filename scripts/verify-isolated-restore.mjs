import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const container = "supabase_db_stallorder-compliance-20260913";
const target = JSON.parse(execFileSync("docker", ["inspect", "--format", "{{json .}}", container], { encoding: "utf8", windowsHide: true }));
if (target.Config.Labels["com.supabase.cli.project"] !== "stallorder-compliance-20260913"
  || target.NetworkSettings.Ports["5432/tcp"]?.[0]?.HostPort !== "55992") throw new Error("RESTORE_LAB_MISMATCH");
const sql = `
begin;
do $$ begin if current_database() <> 'privacy_restore' then raise exception 'RESTORE_DATABASE_MISMATCH'; end if; end $$;
create temporary table financial_before as select count(*) as orders, coalesce(sum(total),0) as total from public.orders;
update public.auth_sessions set revoked_at=now(),revoke_reason='ISOLATED_RESTORE_REAUTH_REQUIRED' where revoked_at is null;
update public.security_step_up_grants set consumed_at=now() where consumed_at is null;
update public.security_support_grants set revoked_at=now() where revoked_at is null;
update public.client_devices set status='REVOKED',revoked_at=now(),offline_enabled=false;
update public.printers set is_enabled=false;
update public.printers set credential_version=credential_version+1,credential_rotated_at=now(),
  device_token_hash=encode(extensions.digest(gen_random_uuid()::text,'sha256'),'hex') where device_id is not null;
do $$ begin
  if not exists(select 1 from public.privacy_deletion_tombstones) then raise exception 'TOMBSTONES_MISSING'; end if;
  if exists(select 1 from public.orders where privacy_contact_erased_at is not null
    and (customer_phone is not null or delivery_address is not null or customer_name <> '[removed]')) then raise exception 'ERASED_DATA_REVIVED'; end if;
  if exists(select 1 from financial_before b where b.orders <> (select count(*) from public.orders)
    or b.total <> (select coalesce(sum(total),0) from public.orders)) then raise exception 'FINANCIAL_DATA_CHANGED'; end if;
end $$;
select json_build_object('database',current_database(),'orders',b.orders,'orderTotal',b.total,
 'tombstones',(select count(*) from public.privacy_deletion_tombstones),
 'erasedOrders',(select count(*) from public.orders where privacy_contact_erased_at is not null),
 'activeSessions',(select count(*) from public.auth_sessions where revoked_at is null),
 'activeSupportGrants',(select count(*) from public.security_support_grants where revoked_at is null),
 'unconsumedStepUpGrants',(select count(*) from public.security_step_up_grants where consumed_at is null),
 'activeOfflineDevices',(select count(*) from public.client_devices where revoked_at is null),
 'enabledPrinters',(select count(*) from public.printers where is_enabled)) from financial_before b;
commit;
`;
const output = execFileSync("docker", ["exec", "-i", container, "psql", "-X", "-qAt", "-v", "ON_ERROR_STOP=1", "-U", "supabase_admin", "-d", "privacy_restore"],
  { input: sql, encoding: "utf8", windowsHide: true });
const result = { observedAt: new Date().toISOString(), container, port: 55992, scope: "SYNTHETIC_DATABASE_RESTORE_ONLY",
  status: "PASS", checks: JSON.parse(output.trim()), externalDispatches: 0,
  excluded: ["pg_cron and cron schema", "Storage object bytes", "provider Auth configuration", "newer independent deletion/revocation feed", "external key revocation", "Production RPO/RTO"] };
writeFileSync("docs/security-compliance/restore-receipt.json", JSON.stringify(result, null, 2) + "\n");
console.log(JSON.stringify(result));
