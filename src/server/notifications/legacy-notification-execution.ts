import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { lineIntegrationSecretsSchema, lineIntegrationSettingsSchema, lineRecipientSecretSchema } from "@/lib/line-notification-contract";
import { EntitlementService } from "@/server/billing/entitlement-service";
import { decryptPlatformValue, encryptPlatformValue } from "@/server/line-platform/crypto";
import { readNotificationSecret } from "./notification-secrets";
import { lineTemplateEnabled } from "./line-integration-service";
import { getLegacyLineMockTransport } from "./line-messaging-provider";
import { resolveLegacyLineSender } from "./line-sender-policy";
import type { NotificationMessage } from "./notification-provider";
import type { renderLineNotification } from "./notification-job-processor";

export type LegacyNotificationClaim = { id: string; token: string };
type LegacyJob = {
  id: string; organization_id: string; stall_id: string; order_id: string; integration_id: string;
  contact_link_id: string; recipient_reference: string; recipient_identity_hash: string | null;
  template_code: Parameters<typeof renderLineNotification>[0]["templateCode"]; template_version: number; event_version: number;
  retry_key: string | null; environment: string | null; attempt_count: number; outcome: string;
  legacy_intent_json: unknown; snapshot_ciphertext: string | null; payload_hash: string | null;
  first_request_at: Date | null;
};
const intentSchema = z.object({
  version: z.literal(1), purpose: z.enum(["COMMERCE", "LOCAL_MOCK_TEST"]),
  organizationId: z.string().uuid(), stallId: z.string().uuid(), orderId: z.string().uuid(),
  integrationId: z.string().uuid(), contactLinkId: z.string().uuid(), recipientReference: z.string().uuid(),
  recipientHash: z.string(), providerId: z.string().nullable(), environment: z.string().nullable(),
  destination: z.string().nullable(), secretRevision: z.string().uuid().nullable(), loginChannelId: z.string().nullable(),
  messagingChannelId: z.string().nullable(), policy: z.enum(["MERCHANT_OA", "PLATFORM_OA"]),
  notifyConfirmed: z.boolean(), notifyReady: z.boolean(), notifyCancelled: z.boolean(), templateVersion: z.number().int(),
}).strict();
const messageSchema = z.object({ jobId: z.string().uuid(), recipient: z.string().min(1).max(100), text: z.string().min(1).max(5000) }).strict();
const purpose = "legacy-notification-v1";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
class DeliveryBlocked extends Error {}

/** Recover only this queue's jobs; an old or granted effect has an unknown outcome. */
export async function recoverLegacyNotificationJobs() {
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<LegacyJob[]>`select * from public.notification_jobs where delivery_mode='LEGACY' and (
      (status='PROCESSING' and ((lease_expires_at is not null and lease_expires_at<=clock_timestamp())
        or (lease_expires_at is null and updated_at<clock_timestamp()-interval '10 minutes')))
      or (legacy_intent_json is null and status in ('PENDING','FAILED') and outcome<>'MANUAL_REVIEW'))
      order by created_at limit 50 for update skip locked`;
    for (const job of rows) {
      const safePreEffect = job.legacy_intent_json !== null && job.outcome === "QUEUED";
      const retry = safePreEffect && job.attempt_count < 5;
      const outcome = retry ? "RETRY_SCHEDULED" : safePreEffect ? "FAILED" : "MANUAL_REVIEW";
      const code = safePreEffect ? "LEGACY_PRE_EFFECT_LEASE_EXPIRED" : "LEGACY_DELIVERY_OUTCOME_UNKNOWN";
      await tx.$executeRaw`update public.notification_jobs set status='FAILED',outcome=${outcome},
        next_attempt_at=case when ${retry} then clock_timestamp() else null end,last_error_code=${code},
        lease_token=null,lease_expires_at=null where id=${job.id}::uuid and delivery_mode='LEGACY'`;
    }
    return rows.map(row => row.id);
  });
}

export async function claimLegacyNotificationJobs(limit: number): Promise<LegacyNotificationClaim[]> {
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error("LEGACY_BATCH_LIMIT_INVALID");
  return prisma.$transaction(async tx => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`select id::text from public.notification_jobs
      where delivery_mode='LEGACY' and legacy_intent_json is not null and attempt_count<5
      and ((status='PENDING' and outcome='QUEUED') or (status='FAILED' and outcome='RETRY_SCHEDULED'))
      and (next_attempt_at is null or next_attempt_at<=clock_timestamp()) order by created_at limit ${limit} for update skip locked`;
    const claims: LegacyNotificationClaim[] = [];
    for (const row of rows) {
      const token = randomUUID();
      await tx.$executeRaw`update public.notification_jobs set status='PROCESSING',outcome='QUEUED',attempt_count=attempt_count+1,
        next_attempt_at=null,lease_token=${token}::uuid,lease_expires_at=clock_timestamp()+interval '90 seconds' where id=${row.id}::uuid`;
      claims.push({ id: row.id, token });
    }
    return claims;
  });
}

async function lockClaim(tx: Prisma.TransactionClient, claim: LegacyNotificationClaim, outcome: "QUEUED" | "IN_FLIGHT") {
  const [job] = await tx.$queryRaw<LegacyJob[]>`select * from public.notification_jobs where id=${claim.id}::uuid and delivery_mode='LEGACY'
    and status='PROCESSING' and outcome=${outcome} and lease_token=${claim.token}::uuid and lease_expires_at>clock_timestamp() for update`;
  if (!job) throw new Error("LEGACY_LEASE_STALE");
  return job;
}

async function currentEligibility(tx: Prisma.TransactionClient, job: LegacyJob) {
  const parsed = intentSchema.safeParse(job.legacy_intent_json);
  if (!parsed.success) throw new DeliveryBlocked("LEGACY_INTENT_MISSING");
  const intent = parsed.data;
  await tx.$queryRaw`select id from public.organizations where id=${job.organization_id}::uuid for share`;
  await tx.$queryRaw`select id from public.stalls where id=${job.stall_id}::uuid for share`;
  await tx.$queryRaw`select id from public.orders where id=${job.order_id}::uuid for share`;
  const [binding] = await tx.$queryRaw<Array<{ sender_scope: string; environment: string | null; provider_id: string | null; oa_destination: string | null; quota_limit: number | null; quota_usage: number | null; paused_until: Date | null }>>`
    select sender_scope,environment,provider_id,oa_destination,quota_limit,quota_usage,paused_until from public.notification_integrations where id=${job.integration_id}::uuid for update`;
  await tx.$queryRaw`select id from public.customer_contact_links where id=${job.contact_link_id}::uuid for share`;
  await tx.$queryRaw`select id from public.subscriptions where organization_id=${job.organization_id}::uuid for share`;
  const flags = await tx.$queryRaw<Array<{ code: string }>>`select code from public.billing_feature_flags where code='OPEN_BETA_FREE_ACCESS_ENABLED' for share`;
  if (!flags.length) await tx.$executeRaw`lock table public.billing_feature_flags in share mode`;
  await tx.$queryRaw`select pe.id from public.plan_entitlements pe join public.subscriptions s on s.plan_version_id=pe.plan_version_id
    where s.organization_id=${job.organization_id}::uuid and pe.feature_code='LINE_NOTIFICATIONS' order by pe.id for share of pe`;
  const items = await tx.$queryRaw<Array<{ code: string }>>`select si.code from public.subscription_items si join public.subscriptions s on s.id=si.subscription_id
    where s.organization_id=${job.organization_id}::uuid and si.item_type='ADD_ON' order by si.id for share of si`;
  if (items.length) await tx.$queryRaw`select id from public.add_on_catalog where code in (${Prisma.join(items.map(item => item.code))}) and feature_code='LINE_NOTIFICATIONS' order by id for share`;
  const integration = await tx.notificationIntegration.findUniqueOrThrow({ where: { id: job.integration_id } });
  const contact = await tx.customerContactLink.findUniqueOrThrow({ where: { id: job.contact_link_id } });
  const order = await tx.order.findUniqueOrThrow({ where: { id: job.order_id }, include: { stall: true, organization: true } });
  const settings = lineIntegrationSettingsSchema.safeParse(integration.settingsJson);
  const management = settings.success ? settings.data.webhookManagement : undefined;
  const owners = await tx.$queryRaw<Array<{ order_id: string }>>`select order_id from public.line_platform_order_owners where order_id=${job.order_id}::uuid`;
  if (owners.length) throw new DeliveryBlocked("PLATFORM_ORDER_LEGACY_BLOCKED");
  if (!binding || binding.sender_scope !== "LEGACY" || integration.provider !== "LINE" || integration.status !== "ACTIVE"
    || integration.organizationId !== job.organization_id || integration.stallId !== job.stall_id
    || contact.integrationId !== integration.id || contact.customerReferenceId !== job.order_id || contact.provider !== "LINE"
    || contact.organizationId !== job.organization_id || contact.stallId !== job.stall_id || contact.consentStatus !== "GRANTED"
    || contact.revokedAt || contact.providerUserSecretReference !== job.recipient_reference || contact.providerUserIdHash !== job.recipient_identity_hash
    || order.organizationId !== job.organization_id || order.stallId !== job.stall_id || !order.stall.isActive
    || ["SUSPENDED", "CANCELLED"].includes(order.organization.status)
    || !lineTemplateEnabled(integration.settingsJson, job.template_code)) throw new DeliveryBlocked("LEGACY_CURRENT_ELIGIBILITY_REVOKED");
  let currentEvent: boolean;
  if (job.template_code === "FULFILLMENT_TIME_PROPOSED") {
    const [clock] = await tx.$queryRaw<Array<{ now: Date }>>`select clock_timestamp() as now`;
    currentEvent = job.event_version === order.fulfillmentTimeVersion
      && order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED"
      && order.pendingFulfillmentAt !== null && order.fulfillmentTimeResponseExpiresAt !== null
      && order.fulfillmentTimeResponseExpiresAt > clock.now
      && !["COMPLETED", "CANCELLED", "EXPIRED"].includes(order.status);
  } else {
    currentEvent = job.event_version === 0 && (
      (job.template_code === "ORDER_CONFIRMED" && ["CONFIRMED", "PREPARING"].includes(order.status))
      || (job.template_code === "ORDER_READY" && order.status === "READY")
      || (job.template_code === "ORDER_CANCELLED" && order.status === "CANCELLED"));
  }
  if (!currentEvent) throw new DeliveryBlocked("LEGACY_ORDER_EVENT_SUPERSEDED");
  if (intent.organizationId !== job.organization_id || intent.stallId !== job.stall_id || intent.orderId !== job.order_id
    || intent.integrationId !== job.integration_id || intent.contactLinkId !== job.contact_link_id
    || intent.recipientReference !== job.recipient_reference || intent.recipientHash !== contact.providerUserIdHash
    || intent.providerId !== binding.provider_id || intent.environment !== binding.environment || job.environment !== binding.environment
    || intent.destination !== binding.oa_destination || intent.secretRevision !== integration.secretReference
    || intent.loginChannelId !== integration.publicIdentifier || intent.messagingChannelId !== management?.messagingChannelId
    || intent.policy !== management?.senderPolicy || intent.templateVersion !== job.template_version
    || !settings.success || intent.notifyConfirmed !== settings.data.notifyConfirmed || intent.notifyReady !== settings.data.notifyReady
    || intent.notifyCancelled !== settings.data.notifyCancelled) throw new DeliveryBlocked("LEGACY_SENDER_REVISION_CHANGED");
  if (intent.purpose !== "LOCAL_MOCK_TEST" || !order.isTest || binding.environment !== "local" || !management?.localMock) {
    throw new DeliveryBlocked("LEGACY_DELIVERY_DISABLED");
  }
  const transport = getLegacyLineMockTransport();
  if (!transport) throw new DeliveryBlocked("LEGACY_DELIVERY_DISABLED");
  if (binding.paused_until && binding.paused_until > new Date()) throw new DeliveryBlocked("LEGACY_SENDER_PAUSED");
  if (binding.quota_limit === null || binding.quota_usage === null || binding.quota_usage >= binding.quota_limit) throw new DeliveryBlocked("LEGACY_QUOTA_BLOCKED");
  await new EntitlementService(tx).assertFeatureEnabled(job.organization_id, "LINE_NOTIFICATIONS");
  const integrationSecret = lineIntegrationSecretsSchema.parse(JSON.parse(await readNotificationSecret(integration.secretReference!, tx)));
  const recipient = lineRecipientSecretSchema.parse(JSON.parse(await readNotificationSecret(job.recipient_reference, tx)));
  const sender = resolveLegacyLineSender({ settings: integration.settingsJson, providerId: binding.provider_id, destination: binding.oa_destination, recipientProviderId: recipient.providerId });
  if (sender.sender === "NONE") throw new DeliveryBlocked(sender.reason);
  if (hash(recipient.providerUserId) !== job.recipient_identity_hash) throw new DeliveryBlocked("LEGACY_RECIPIENT_CHANGED");
  return { order, recipient, integrationSecret, transport };
}

async function suppress(tx: Prisma.TransactionClient, claim: LegacyNotificationClaim, error: unknown) {
  const code = error instanceof DeliveryBlocked ? error.message : "LEGACY_CONFIGURATION_REQUIRED";
  await tx.$executeRaw`update public.notification_jobs set status='FAILED',outcome='SUPPRESSED',last_error_code=${code},next_attempt_at=null,
    lease_token=null,lease_expires_at=null where id=${claim.id}::uuid and delivery_mode='LEGACY' and status='PROCESSING'
    and outcome='QUEUED' and lease_token=${claim.token}::uuid and lease_expires_at>clock_timestamp()`;
  return { jobId: claim.id, status: "PAUSED" as const, sender: "NONE" as const, reason: code };
}

export async function prepareLegacyNotification(claim: LegacyNotificationClaim, render: typeof renderLineNotification) {
  return prisma.$transaction(async tx => {
    const job = await lockClaim(tx, claim, "QUEUED");
    try {
      const { order, recipient } = await currentEligibility(tx, job);
      if (job.snapshot_ciphertext) {
        const raw = decryptPlatformValue(job.snapshot_ciphertext, purpose);
        if (hash(raw) !== job.payload_hash) throw new DeliveryBlocked("LEGACY_SNAPSHOT_INVALID");
        const message = messageSchema.parse(JSON.parse(raw));
        if (message.jobId !== job.retry_key || message.recipient !== recipient.providerUserId) throw new DeliveryBlocked("LEGACY_SNAPSHOT_INVALID");
        return { jobId: job.id, hash: job.payload_hash!, message };
      }
      const appUrl = process.env.NEXT_PUBLIC_APP_URL?.trim().replace(/\/$/, "");
      if (!appUrl || new URL(appUrl).protocol !== "https:") throw new DeliveryBlocked("NOTIFICATION_APP_URL_INVALID");
      const message: NotificationMessage = { jobId: job.retry_key!, recipient: recipient.providerUserId, text: render({
        templateCode: job.template_code, stallName: order.stall.name, orderNo: order.orderNo, fulfillmentType: order.fulfillmentType,
        pickupCode: order.pickupCodeDisplay, quotedWaitMinutes: order.quotedWaitMinutes, total: order.total,
        pendingFulfillmentAt: order.pendingFulfillmentAt, fulfillmentTimeChangeReason: order.fulfillmentTimeChangeReason,
        timezone: order.stall.timezone, trackingToken: recipient.trackingToken, appUrl,
      }) };
      const raw = JSON.stringify(messageSchema.parse(message)), payloadHash = hash(raw), ciphertext = encryptPlatformValue(raw, purpose);
      const changed = await tx.$executeRaw`update public.notification_jobs set snapshot_ciphertext=${ciphertext},payload_hash=${payloadHash}
        where id=${job.id}::uuid and lease_token=${claim.token}::uuid and lease_expires_at>clock_timestamp() and outcome='QUEUED'`;
      if (changed !== 1) throw new Error("LEGACY_LEASE_STALE");
      return { jobId: job.id, hash: payloadHash, message };
    } catch (error) { return suppress(tx, claim, error); }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export async function authorizeLegacyEffect(claim: LegacyNotificationClaim, payloadHash: string) {
  return prisma.$transaction(async tx => {
    const job = await lockClaim(tx, claim, "QUEUED");
    try {
      const current = await currentEligibility(tx, job);
      if (!job.snapshot_ciphertext || job.payload_hash !== payloadHash) throw new DeliveryBlocked("LEGACY_SNAPSHOT_INVALID");
      const raw = decryptPlatformValue(job.snapshot_ciphertext, purpose);
      if (hash(raw) !== payloadHash) throw new DeliveryBlocked("LEGACY_SNAPSHOT_INVALID");
      const changed = await tx.$executeRaw`update public.notification_jobs set outcome='IN_FLIGHT',first_request_at=coalesce(first_request_at,clock_timestamp())
        where id=${job.id}::uuid and lease_token=${claim.token}::uuid and lease_expires_at>clock_timestamp() and outcome='QUEUED'`;
      if (changed !== 1) throw new Error("LEGACY_LEASE_STALE");
      await tx.$executeRaw`update public.notification_integrations set quota_usage=quota_usage+1,last_dispatch_at=clock_timestamp() where id=${job.integration_id}::uuid`;
      return { token: current.integrationSecret.channelAccessToken, transport: current.transport };
    } catch (error) { return suppress(tx, claim, error); }
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

/** The committed effect grant is completed only by its current, unexpired owner. */
export async function completeLegacyNotification(claim: LegacyNotificationClaim, result: {
  outcome: "SIMULATED" | "MANUAL_REVIEW" | "FAILED" | "RETRY_SCHEDULED";
  providerMessageId?: string | null; code?: string; retryAt?: Date | null;
}) {
  const success = result.outcome === "SIMULATED";
  const changed = await prisma.$executeRaw`update public.notification_jobs set status=${success ? "SENT" : "FAILED"}::public.notification_job_status,
    outcome=${result.outcome},sent_at=case when ${success} then clock_timestamp() else null end,
    provider_message_id=${result.providerMessageId ?? null},last_error_code=${result.code ?? null},next_attempt_at=${result.retryAt ?? null},
    lease_token=null,lease_expires_at=null where id=${claim.id}::uuid and delivery_mode='LEGACY' and status='PROCESSING'
    and outcome='IN_FLIGHT' and lease_token=${claim.token}::uuid and lease_expires_at>clock_timestamp()`;
  return changed === 1;
}

export async function legacyClaimAttempt(claim: LegacyNotificationClaim) {
  const [job] = await prisma.$queryRaw<Array<{ attempt_count: number }>>`select attempt_count from public.notification_jobs
    where id=${claim.id}::uuid and lease_token=${claim.token}::uuid and delivery_mode='LEGACY'`;
  return job?.attempt_count ?? 5;
}
