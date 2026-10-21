import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { readNotificationSecret } from "@/server/notifications/notification-secrets";
import { decryptPlatformValue, encryptPlatformValue, hashPlatformSubject } from "./crypto";
import { getLinePlatformRuntime, type LinePlatformRuntime } from "./runtime";
import { platformPayloadHash, pushPlatformSnapshot, readPlatformQuota, verifyPlatformBotIdentity, type PushResult } from "./messaging";
import { buildPlatformMessages, type PlatformNotificationEvent } from "./messaging-template";
import { processPlatformFriendshipEvents } from "./notification-webhook";
import { pickupMediaPattern } from "./pickup-contract";

type Job = {
  id: string; order_id: string; organization_id: string; stall_id: string; integration_id: string; environment: string;
  recipient_identity_hash: string; recipient_reference: string; template_code: PlatformNotificationEvent; retry_key: string;
  snapshot_ciphertext: string | null; payload_hash: string | null; first_request_at: Date | null; attempt_count: number;
};
type CurrentOrder = {
  status: string; payment_status: string; order_no: string; total: number; pickup_code_display: string | null;
  created_at: Date; completed_at: Date | null; expected_at: Date | null; stall_name: string; address: string; phone: string;
  eligible: boolean; friendship: string | null; picked_up: boolean; fulfillment_type: string; payment_pending: boolean;
};

export async function processPlatformNotifications(now = new Date(), fetchImpl: typeof fetch = fetch) {
  const runtime = getLinePlatformRuntime();
  if (!runtime) return [];
  await processPlatformFriendshipEvents(runtime);
  if (!runtime.notificationsEnabled) return [];
  const [integration] = await prisma.$queryRaw<Array<{ id: string; quota_checked_at: Date | null }>>`select id::text,quota_checked_at from public.notification_integrations
    where sender_scope='PLATFORM_OA' and environment=${runtime.environment} and provider_id=${runtime.providerId} and oa_destination=${runtime.oaDestination}
      and public_identifier=${runtime.oaChannelId} and secret_reference=${runtime.oaAccessTokenReference}::uuid and status='ACTIVE'`;
  if (!integration) return [];
  let token: string;
  const blockSender = async (code: string) => {
    await prisma.$executeRaw`update public.notification_integrations set settings_json=jsonb_set(settings_json,'{lastWorkerError}',to_jsonb(${code}::text)),paused_until=${now}+interval '5 minutes' where id=${integration.id}::uuid`;
    return [{status:code}];
  };
  try { token = await readNotificationSecret(runtime.oaAccessTokenReference); await verifyPlatformBotIdentity(token,runtime.oaDestination,fetchImpl); }
  catch { return blockSender("PLATFORM_SENDER_UNVERIFIED"); }
  if (!integration.quota_checked_at || now.getTime() - integration.quota_checked_at.getTime() > 300_000) {
    try {
      const quota = await readPlatformQuota(token, fetchImpl);
      await prisma.$executeRaw`update public.notification_integrations set quota_limit=${quota.limit},quota_usage=${quota.usage},quota_checked_at=${now},
        paused_until=case when ${quota.limit}::integer is not null and ${quota.usage}>=${quota.limit}::integer then ${now}+interval '5 minutes' else null end where id=${integration.id}::uuid`;
    } catch { return blockSender("QUOTA_UNAVAILABLE"); }
  }
  await prisma.$executeRaw`update public.notification_integrations set settings_json=settings_json-'lastWorkerError' where id=${integration.id}::uuid and settings_json ? 'lastWorkerError'`;
  const lease = randomUUID();
  const jobs = await claimPlatformJobs(integration.id, runtime.environment, lease, now);
  return Promise.all(jobs.map((job) => dispatchPlatformJob(job, lease, runtime, token, now, fetchImpl)));
}

async function claimPlatformJobs(integrationId: string, environment: string, lease: string, now: Date) {
  return prisma.$transaction(async (db) => {
    const active = await db.$queryRaw<Array<{ id: string; quota_limit: number | null; quota_usage: number | null }>>`select id::text,quota_limit,quota_usage from public.notification_integrations
      where id=${integrationId}::uuid and status='ACTIVE' and (paused_until is null or paused_until<=${now})
        and (last_dispatch_at is null or last_dispatch_at<${now}-interval '1 second') for update skip locked`;
    if (!active.length) return [];
    const capacity = active[0].quota_limit === null ? 20 : Math.max(0, Math.min(20, active[0].quota_limit - (active[0].quota_usage ?? 0)));
    await db.$executeRaw`update public.notification_jobs set status='FAILED',outcome=case when attempt_count>=6 or first_request_at<=${now}-interval '24 hours' then 'MANUAL_REVIEW' else 'RETRY_SCHEDULED' end,
      next_attempt_at=case when attempt_count>=6 or first_request_at<=${now}-interval '24 hours' then null else ${now} end,
      lease_token=null,lease_expires_at=null,last_error_code='WORKER_LEASE_EXPIRED'
      where delivery_mode='PLATFORM_OA' and integration_id=${integrationId}::uuid and outcome='IN_FLIGHT' and lease_expires_at<=${now}`;
    await db.$executeRaw`update public.notification_jobs set status='FAILED',outcome='MANUAL_REVIEW',next_attempt_at=null,lease_token=null,lease_expires_at=null,
      last_error_code=case when attempt_count>=6 then 'ATTEMPTS_EXHAUSTED' else 'RETRY_WINDOW_EXPIRED' end
      where delivery_mode='PLATFORM_OA' and integration_id=${integrationId}::uuid and outcome in ('QUEUED','RETRY_SCHEDULED')
        and (attempt_count>=6 or first_request_at<=${now}-interval '24 hours')`;
    if (!capacity) return [];
    const jobs = await db.$queryRaw<Job[]>`with ranked as (
      select id,row_number() over(partition by stall_id order by case when template_code='ORDER_READY' then 0 else 1 end,created_at,id) as store_rank
      from public.notification_jobs where delivery_mode='PLATFORM_OA' and integration_id=${integrationId}::uuid and environment=${environment}
        and outcome in ('QUEUED','RETRY_SCHEDULED') and attempt_count<6 and next_attempt_at<=${now}
    ), selected as (
      select j.id from public.notification_jobs j join ranked r on r.id=j.id where r.store_rank=1
      order by j.created_at,j.id limit ${capacity} for update of j skip locked
    ) update public.notification_jobs j set status='PROCESSING',outcome='IN_FLIGHT',attempt_count=attempt_count+1,
      lease_token=${lease}::uuid,lease_expires_at=${now}+interval '90 seconds',next_attempt_at=null
      where j.id in(select id from selected) returning j.*`;
    if (jobs.length) await db.$executeRaw`update public.notification_integrations set last_dispatch_at=${now},quota_usage=coalesce(quota_usage,0)+${jobs.length} where id=${integrationId}::uuid`;
    return jobs;
  });
}

async function readCurrentOrder(job: Job, runtime: LinePlatformRuntime): Promise<CurrentOrder | undefined> {
  const [order] = await prisma.$queryRaw<CurrentOrder[]>`select o.status::text,o.payment_status::text,o.fulfillment_type::text,o.order_no,o.total,o.pickup_code_display,o.created_at,o.completed_at,
    coalesce(o.committed_fulfillment_at,o.requested_fulfillment_at,o.scheduled_pickup_at,o.quoted_ready_at) as expected_at,s.name as stall_name,s.address,s.phone,
    (m.notification_consent and m.revoked_at is null and a.revoked_at is null and p.is_active and ps.enabled and o.created_at>=ps.cutover_at
      and i.status='ACTIVE' and i.environment=owner.environment and i.provider_id=owner.provider_id and i.oa_destination=${runtime.oaDestination}) as eligible,
    f.status as friendship,exists(select 1 from public.order_events e where e.order_id=o.id and e.event_type='LINE_PLATFORM_PICKED_UP') as picked_up,
    (o.payment_status='PENDING_RECONCILIATION' or (o.payment_status<>'PAID' and exists(select 1 from public.payment_provider_transactions t
      where t.order_id=o.id and t.provider='LINE_PAY' and t.status not in ('FAILED','CANCELLED','EXPIRED')))) as payment_pending
    from public.orders o join public.stalls s on s.id=o.stall_id
    join public.line_platform_order_owners owner on owner.order_id=o.id and owner.environment=${job.environment} and owner.subject_hash=${job.recipient_identity_hash}
    join public.line_platform_members m on m.profile_id=owner.profile_id and m.environment=owner.environment and m.provider_id=owner.provider_id and m.subject_hash=owner.subject_hash
    join public.auth_identities a on a.id=m.auth_identity_id join public.profiles p on p.id=m.profile_id
    join public.line_platform_stalls ps on ps.stall_id=o.stall_id and ps.environment=owner.environment
    join public.notification_integrations i on i.id=${job.integration_id}::uuid and i.sender_scope='PLATFORM_OA'
    left join public.line_platform_friendships f on f.integration_id=i.id and f.environment=owner.environment and f.subject_hash=owner.subject_hash
    where o.id=${job.order_id}::uuid and o.organization_id=${job.organization_id}::uuid and o.stall_id=${job.stall_id}::uuid`;
  return order;
}

export function platformNotificationSuppression(event: PlatformNotificationEvent, order: (Pick<CurrentOrder,"status"|"payment_status"|"eligible"|"friendship"|"picked_up"> & { payment_pending?: boolean }) | undefined) {
  if (!order || !order.eligible) return "MEMBER_NOT_ELIGIBLE";
  if (order.friendship !== "FRIEND") return "FRIEND_NOT_CONFIRMED";
  if (event === "ORDER_READY" && (order.status !== "READY" || order.picked_up || order.payment_status === "REFUNDED")) return "ORDER_NO_LONGER_READY";
  if (event === "ORDER_RECEIPT_AVAILABLE" && ["CANCELLED","EXPIRED"].includes(order.status)) return "ORDER_NO_LONGER_ACTIVE";
  if (event === "ORDER_RECEIPT_AVAILABLE" && order.payment_pending) return "PAYMENT_NOT_SETTLED";
  if (event === "ORDER_PICKED_UP" && !order.picked_up) return "PICKUP_EVENT_MISSING";
  if (event === "ORDER_CANCELLED" && order.status !== "CANCELLED") return "CANCELLATION_EVENT_MISSING";
  return null;
}

async function snapshotPickupIsCurrent(job: Job, body: string, runtime: LinePlatformRuntime, order: CurrentOrder) {
  if (order.fulfillment_type !== "TAKEOUT" || !["ORDER_RECEIPT_AVAILABLE","ORDER_READY"].includes(job.template_code)) return true;
  const payload = JSON.parse(body) as { messages: Array<{ contents?: { body?: { contents?: Array<{ type: string; url?: string }> } } }> };
  const images = payload.messages.flatMap(message => message.contents?.body?.contents ?? []).filter(item => item.type === "image");
  if (images.length !== 1 || !images[0].url) return false;
  const media = new URL(images[0].url);
  const token = media.pathname.slice("/api/line-platform/media/".length);
  if (media.origin !== new URL(runtime.endpointUrl).origin || !media.pathname.startsWith("/api/line-platform/media/")
    || media.search || media.hash || !pickupMediaPattern.test(token)) return false;
  const mediaHash = createHash("sha256").update(token).digest("hex");
  const [current] = await prisma.$queryRaw<Array<{ id: string }>>`select c.id from public.line_platform_pickup_credentials c
    join public.orders o on o.id=c.order_id where c.order_id=${job.order_id}::uuid and c.organization_id=${job.organization_id}::uuid
      and c.stall_id=${job.stall_id}::uuid and c.environment=${job.environment} and c.media_hash=${mediaHash}
      and c.revoked_at is null and c.consumed_at is null and c.expires_at>now() and c.media_expires_at>now()
      and c.fulfillment_time_version=o.fulfillment_time_version`;
  return Boolean(current);
}

async function dispatchPlatformJob(job: Job, lease: string, runtime: LinePlatformRuntime, token: string, now: Date, fetchImpl: typeof fetch) {
  const finish = async (result: PushResult | { outcome: "SUPPRESSED"; errorCode: string }) => {
    let outcome = result.outcome;
    if (outcome === "RETRY_SCHEDULED" && job.attempt_count >= 6) outcome = "MANUAL_REVIEW";
    const retryAt = outcome === "RETRY_SCHEDULED" ? new Date(Date.now() + Math.min(1800, 2 ** job.attempt_count * 10) * 1000 + Math.floor(Math.random() * 5000)) : null;
    const status = outcome === "PROVIDER_ACCEPTED" ? "SENT" : outcome === "SUPPRESSED" ? "CANCELLED" : "FAILED";
    const written = await prisma.$executeRaw`update public.notification_jobs set status=${status}::public.notification_job_status,outcome=${outcome},next_attempt_at=${retryAt},
      sent_at=${outcome === "PROVIDER_ACCEPTED" ? new Date() : null},last_error_code=${result.errorCode ?? null},provider_message_id=${"requestId" in result ? result.requestId ?? null : null},
      provider_accepted_request_id=${"acceptedRequestId" in result ? result.acceptedRequestId ?? null : null},lease_token=null,lease_expires_at=null
      where id=${job.id}::uuid and lease_token=${lease}::uuid and outcome='IN_FLIGHT'`;
    if (outcome === "QUOTA_BLOCKED") await prisma.$executeRaw`update public.notification_integrations set paused_until=${now}+interval '5 minutes',quota_checked_at=null where id=${job.integration_id}::uuid`;
    return { jobId: job.id, status: written ? outcome : "LEASE_LOST" };
  };
  try {
    const order = await readCurrentOrder(job, runtime);
    const suppression = platformNotificationSuppression(job.template_code, order);
    if (suppression) return finish({ outcome: "SUPPRESSED", errorCode: suppression });
    if (!job.snapshot_ciphertext) {
      const secret = JSON.parse(await readNotificationSecret(job.recipient_reference)) as { providerUserId?: string };
      if (!secret.providerUserId || !/^U[0-9a-f]{32}$/.test(secret.providerUserId)
        || hashPlatformSubject(job.environment, runtime.providerId, secret.providerUserId) !== job.recipient_identity_hash) return finish({ outcome: "MANUAL_REVIEW", errorCode: "RECIPIENT_MISMATCH" });
      const { ensurePickupMediaForOrder } = await import("./pickup-service");
      const media = ["ORDER_RECEIPT_AVAILABLE","ORDER_READY"].includes(job.template_code) ? await ensurePickupMediaForOrder(job.order_id, runtime.environment) : null;
      if (["ORDER_RECEIPT_AVAILABLE","ORDER_READY"].includes(job.template_code) && order!.fulfillment_type === "TAKEOUT" && !media) return finish({ outcome: "SUPPRESSED", errorCode: "PICKUP_CREDENTIAL_UNAVAILABLE" });
      const body = JSON.stringify({ to: secret.providerUserId, messages: buildPlatformMessages({
        event: job.template_code,orderId: job.order_id,orderNo: order!.order_no,stallName: order!.stall_name,address: order!.address,phone: order!.phone,total: order!.total,
        paymentStatus: order!.payment_status,pickupCode: order!.pickup_code_display,createdAt: order!.created_at,fulfilledAt: order!.completed_at,expectedAt: order!.expected_at,
        endpointUrl: runtime.endpointUrl,liffId: runtime.liffId,imageUrl: media?.imageUrl ?? null,
      }), notificationDisabled: false });
      job.snapshot_ciphertext = encryptPlatformValue(body, `notification:${job.id}`);
      job.payload_hash = platformPayloadHash(body);
      job.first_request_at = new Date();
      const persisted = await prisma.$executeRaw`update public.notification_jobs set snapshot_ciphertext=${job.snapshot_ciphertext},payload_hash=${job.payload_hash},first_request_at=${job.first_request_at}
        where id=${job.id}::uuid and lease_token=${lease}::uuid and outcome='IN_FLIGHT' and first_request_at is null and lease_expires_at>now()`;
      if (!persisted) return { jobId: job.id, status: "LEASE_LOST" };
    }
    // Recheck current eligibility after potentially issuing the QR and before external I/O.
    const latestOrder = await readCurrentOrder(job, runtime);
    const lateSuppression = platformNotificationSuppression(job.template_code, latestOrder);
    if (lateSuppression) return finish({ outcome: "SUPPRESSED", errorCode: lateSuppression });
    const body = decryptPlatformValue(job.snapshot_ciphertext, `notification:${job.id}`);
    if (!await snapshotPickupIsCurrent(job, body, runtime, latestOrder!)) {
      return finish({ outcome: "MANUAL_REVIEW", errorCode: "PICKUP_SNAPSHOT_STALE" });
    }
    const [held] = await prisma.$queryRaw<Array<{ id: string }>>`select id::text from public.notification_jobs where id=${job.id}::uuid and lease_token=${lease}::uuid and outcome='IN_FLIGHT' and lease_expires_at>now()`;
    if (!held) return { jobId: job.id, status: "LEASE_LOST" };
    return finish(await pushPlatformSnapshot({ body,payloadHash: job.payload_hash!,retryKey: job.retry_key,firstRequestAt: job.first_request_at! },token,new Date(),fetchImpl));
  } catch {
    return finish({ outcome: job.first_request_at ? "MANUAL_REVIEW" : "FAILED", errorCode: "PLATFORM_NOTIFICATION_PROCESSING_FAILED" });
  }
}

export async function retryPlatformNotification(jobId: string, stallId: string, reason: string, actorId: string, requestId: string) {
  if (reason.trim().length < 2 || reason.length > 200) throw new Error("RETRY_REASON_REQUIRED");
  return prisma.$transaction(async (db) => {
    const [job] = await db.$queryRaw<Job[]>`select * from public.notification_jobs where id=${jobId}::uuid and stall_id=${stallId}::uuid and delivery_mode='PLATFORM_OA'
      and outcome in ('FAILED','QUOTA_BLOCKED','SUPPRESSED') and manual_retry_count<3 and attempt_count<6
      and (last_manual_retry_at is null or last_manual_retry_at<now()-interval '5 minutes')
      and (first_request_at is null or first_request_at>now()-interval '24 hours') for update`;
    if (!job) throw new Error("NOTIFICATION_RETRY_NOT_ALLOWED");
    const runtime = getLinePlatformRuntime();
    if (!runtime || runtime.environment!==job.environment || platformNotificationSuppression(job.template_code,await readCurrentOrder(job,runtime))) throw new Error("NOTIFICATION_RETRY_NOT_ALLOWED");
    await db.$executeRaw`update public.notification_jobs set status='PENDING',outcome='QUEUED',next_attempt_at=now(),last_error_code=null,manual_retry_count=manual_retry_count+1,last_manual_retry_at=now() where id=${jobId}::uuid`;
    await db.auditLog.create({ data: { organizationId: job.organization_id,stallId,actorProfileId: actorId,action: "LINE_PLATFORM_NOTIFICATION_RETRY",entityType: "NOTIFICATION_JOB",entityId: jobId,outcome: "SUCCESS",requestId,metadata: JSON.stringify({ reason: reason.trim(),sameOperation: true }) } });
    return { queued: true };
  });
}
