import "server-only";
import { prisma } from "@/lib/prisma";
import { hashToken } from "@/lib/security";
import { lineWebhookBodySchema } from "@/lib/line-notification-contract";
import { readNotificationSecret } from "@/server/notifications/notification-secrets";
import { verifyLineWebhookSignature } from "@/server/notifications/line-security";
import { hashPlatformSubject } from "./crypto";
import type { LinePlatformRuntime } from "./runtime";

export async function persistPlatformWebhook(rawBody: string, signature: string | null, runtime: LinePlatformRuntime) {
  const secret = await readNotificationSecret(runtime.oaSecretReference);
  if (!verifyLineWebhookSignature(rawBody, signature, secret)) throw new Error("INVALID_SIGNATURE");
  const body = lineWebhookBodySchema.parse(JSON.parse(rawBody));
  if (body.destination !== runtime.oaDestination) throw new Error("DESTINATION_MISMATCH");
  const [integration] = await prisma.$queryRaw<Array<{ id: string }>>`select id::text from public.notification_integrations where sender_scope='PLATFORM_OA'
    and environment=${runtime.environment} and provider_id=${runtime.providerId} and oa_destination=${runtime.oaDestination} and status='ACTIVE'`;
  if (!integration) throw new Error("PLATFORM_INTEGRATION_UNAVAILABLE");
  await prisma.$transaction(async (db) => {
    for (const event of body.events) {
      if (!['follow','unfollow'].includes(event.type) || event.source?.type !== 'user') continue;
      if (!event.webhookEventId || !/^U[0-9a-f]{32}$/.test(event.source.userId ?? "") || event.timestamp > Date.now() + 300_000) throw new Error("INVALID_FRIENDSHIP_EVENT");
      const hash = hashPlatformSubject(runtime.environment, runtime.providerId, event.source.userId!);
      await db.$executeRaw`insert into public.line_webhook_events(integration_id,provider_event_hash,event_type,provider_event_id,event_timestamp,subject_hash,environment)
        values(${integration.id}::uuid,${hashToken(`${integration.id}:${event.webhookEventId}`)},${event.type},${event.webhookEventId},${new Date(event.timestamp)},${hash},${runtime.environment}) on conflict(provider_event_hash) do nothing`;
    }
  });
  // Receipt is already committed. Recovery cron can process it if this wakeup is unavailable.
  if (runtime.environment !== "local") {
    try { await prisma.$queryRaw`select app_private.invoke_platform_notification_jobs(${integration.id}::uuid)`; } catch { /* Durable receipt remains pending. */ }
  }
}

export async function processPlatformFriendshipEvents(runtime: LinePlatformRuntime) {
  return prisma.$transaction(async (db) => {
    const events = await db.$queryRaw<Array<{ id: string; integration_id: string; subject_hash: string; event_type: string; provider_event_id: string; event_timestamp: Date }>>`
      select e.id::text,e.integration_id::text,e.subject_hash,e.event_type,e.provider_event_id,e.event_timestamp from public.line_webhook_events e
      join public.notification_integrations i on i.id=e.integration_id where e.environment=${runtime.environment} and e.processed_at is null
        and i.sender_scope='PLATFORM_OA' and i.provider_id=${runtime.providerId} and i.oa_destination=${runtime.oaDestination}
      order by e.received_at,e.id limit 100 for update of e skip locked`;
    for (const event of events) {
      const status = event.event_type === "follow" ? "FRIEND" : "NOT_FRIEND_OR_BLOCKED";
      await db.$executeRaw`insert into public.line_platform_friendships(environment,integration_id,provider_id,subject_hash,status,observed_at,event_id,source)
        values(${runtime.environment},${event.integration_id}::uuid,${runtime.providerId},${event.subject_hash},${status},${event.event_timestamp},${event.provider_event_id},'SIGNED_WEBHOOK')
        on conflict(environment,integration_id,subject_hash) do update set status=excluded.status,observed_at=excluded.observed_at,event_id=excluded.event_id,source=excluded.source
        where line_platform_friendships.observed_at<excluded.observed_at or (line_platform_friendships.observed_at=excluded.observed_at and excluded.status='NOT_FRIEND_OR_BLOCKED')`;
      await db.$executeRaw`update public.line_webhook_events set processed_at=now() where id=${event.id}::uuid`;
    }
    // Release only never-attempted, current-order events from a recent order, never all history.
    await db.$executeRaw`update public.notification_jobs j set status='PENDING',outcome='QUEUED',next_attempt_at=now(),last_error_code=null
      from public.orders o,public.line_platform_order_owners owner,public.line_platform_members m,public.line_platform_friendships f
      where j.delivery_mode='PLATFORM_OA' and j.environment=${runtime.environment} and j.outcome='SUPPRESSED' and j.last_error_code='FRIEND_NOT_CONFIRMED'
        and j.first_request_at is null and j.order_id=o.id and o.created_at>now()-interval '24 hours'
        and owner.order_id=o.id and m.profile_id=owner.profile_id and m.subject_hash=j.recipient_identity_hash and m.notification_consent and m.revoked_at is null
        and f.environment=j.environment and f.integration_id=j.integration_id and f.subject_hash=j.recipient_identity_hash and f.status='FRIEND'
        and ((j.template_code='ORDER_READY' and o.status='READY') or (j.template_code='ORDER_RECEIPT_AVAILABLE' and o.status in ('CONFIRMED','PREPARING','PACKING','READY')))`;
    return events.length;
  });
}
