import "server-only";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { storeNotificationSecret } from "@/server/notifications/notification-secrets";
import { decryptPlatformValue } from "./crypto";
import type { LinePlatformRuntime } from "./runtime";

type Database = Pick<Prisma.TransactionClient, "$queryRaw" | "$executeRaw">;
export async function ensurePlatformNotificationIntegration(runtime: LinePlatformRuntime, db: Database = prisma) {
  const [integration] = await db.$queryRaw<Array<{ id: string; provider_id: string; oa_destination: string; public_identifier: string }>>`
    insert into public.notification_integrations(sender_scope,environment,provider_id,oa_destination,provider,status,public_identifier,secret_reference,settings_json)
    values('PLATFORM_OA',${runtime.environment},${runtime.providerId},${runtime.oaDestination},'LINE','ACTIVE',${runtime.oaChannelId},${runtime.oaAccessTokenReference}::uuid,${JSON.stringify({workerOrigin: new URL(runtime.endpointUrl).origin,notificationsEnabled: runtime.notificationsEnabled})}::jsonb)
    on conflict(environment) where sender_scope='PLATFORM_OA' do update
      set secret_reference=excluded.secret_reference,status='ACTIVE',settings_json=excluded.settings_json,quota_checked_at=null
      where notification_integrations.provider_id=excluded.provider_id and notification_integrations.oa_destination=excluded.oa_destination and notification_integrations.public_identifier=excluded.public_identifier
    returning id::text,provider_id,oa_destination,public_identifier`;
  if (!integration) throw new Error("PLATFORM_SENDER_MISMATCH");
  return integration.id;
}

/** Called inside the existing order transaction after the immutable owner is saved. */
export async function bindPlatformOrderNotifications(orderId: string, runtime: LinePlatformRuntime, db: Database = prisma) {
  const [owner] = await db.$queryRaw<Array<{ organization_id: string; stall_id: string; subject_hash: string; subject_ciphertext: string; integration_id: string; notification_consent: boolean }>>`
    select o.organization_id::text,o.stall_id::text,owner.subject_hash,m.subject_ciphertext,i.id::text as integration_id,m.notification_consent
    from public.orders o join public.line_platform_order_owners owner on owner.order_id=o.id
    join public.line_platform_members m on m.profile_id=owner.profile_id and m.environment=owner.environment and m.subject_hash=owner.subject_hash and m.provider_id=owner.provider_id
    join public.line_platform_stalls s on s.stall_id=o.stall_id and s.environment=owner.environment and s.enabled and o.created_at>=s.cutover_at
    join public.notification_integrations i on i.sender_scope='PLATFORM_OA' and i.environment=owner.environment and i.provider_id=owner.provider_id and i.status='ACTIVE' and i.oa_destination=${runtime.oaDestination}
    where o.id=${orderId}::uuid and owner.environment=${runtime.environment} and owner.provider_id=${runtime.providerId} and m.revoked_at is null`;
  if (!owner) return { bound: false };
  const [existing] = await db.$queryRaw<Array<{ integration_id: string; provider_user_id_hash: string }>>`select integration_id::text,provider_user_id_hash from public.customer_contact_links where customer_reference_id=${orderId}::uuid and provider='LINE'`;
  if (existing && (existing.integration_id !== owner.integration_id || existing.provider_user_id_hash !== owner.subject_hash)) return { bound: false };
  if (!existing) {
    const recipient = decryptPlatformValue(owner.subject_ciphertext);
    if (!/^U[0-9a-f]{32}$/.test(recipient)) throw new Error("PLATFORM_IDENTITY_INVALID");
    const reference = await storeNotificationSecret(`stallorder_platform_recipient_${orderId.replaceAll("-", "_")}`, JSON.stringify({ providerUserId: recipient }), "Immutable platform order recipient", db);
    await db.$executeRaw`insert into public.customer_contact_links(organization_id,stall_id,integration_id,customer_reference_id,provider,provider_user_id_hash,provider_user_secret_reference,consent_status,consented_at)
      values(${owner.organization_id}::uuid,${owner.stall_id}::uuid,${owner.integration_id}::uuid,${orderId}::uuid,'LINE',${owner.subject_hash},${reference}::uuid,
        ${owner.notification_consent ? 'GRANTED' : 'PENDING'}::public.customer_consent_status,case when ${owner.notification_consent} then now() else null end)`;
  }
  await db.$executeRaw`select public.enqueue_line_platform_notification(${orderId}::uuid,'ORDER_RECEIPT_AVAILABLE',0)`;
  await db.$executeRaw`select public.enqueue_line_platform_notification(${orderId}::uuid,'ORDER_READY',0)`;
  return { bound: true };
}
