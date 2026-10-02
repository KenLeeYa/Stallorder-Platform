import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { logEvent, recordAuditEvent } from "@/lib/audit";
import { lineIntegrationSecretsSchema, lineIntegrationSettingsSchema, lineWebhookBodySchema } from "@/lib/line-notification-contract";
import { prisma } from "@/lib/prisma";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, hashToken } from "@/lib/security";
import { readLineWebhookBytes, verifyLineWebhookSignature } from "@/server/notifications/line-security";
import { deleteNotificationSecret, readNotificationSecret } from "@/server/notifications/notification-secrets";
import {
  BoundedTextReadError,
} from "@/server/delivery-platforms/bounded-text-reader";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteContext = { params: Promise<{ integrationId: string }> };
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: RouteContext) {
  const requestId = createRequestId();
  const { integrationId } = await context.params;
  if (!UUID_PATTERN.test(integrationId)) return response({ error: "NOT_FOUND" }, 404, requestId);
  if (request.headers.get("content-type")?.split(";", 1)[0]?.trim() !== "application/json") {
    return response({ error: "UNSUPPORTED_MEDIA_TYPE" }, 415, requestId);
  }
  const ipHash = hashClientIp(request);
  const limit = await checkPublicRateLimit({
    scope: "line-webhook",
    sourceIdentifier: ipHash,
    resourceIdentifier: `${integrationId}:${ipHash}`,
    sourceLimit: 1_200,
    resourceLimit: 600,
    windowMs: 5 * 60_000,
  });
  if (!limit.allowed) return response({ error: "RATE_LIMITED" }, 429, requestId, limit.retryAfterSeconds);

  let rawBody: Uint8Array;
  try {
    rawBody = await readLineWebhookBytes(request, 64_000);
  } catch (error) {
    const status = error instanceof BoundedTextReadError
      && (error.reason === "BODY_TOO_LARGE" || error.reason === "INVALID_CONTENT_LENGTH")
      ? 413
      : 408;
    return response({ error: status === 413 ? "REQUEST_TOO_LARGE" : "REQUEST_TIMEOUT" }, status, requestId);
  }
  const integration = await prisma.notificationIntegration.findFirst({
    where: { id: integrationId, provider: "LINE", status: "ACTIVE", stallId: { not: null } },
  });
  if (!integration?.secretReference || !integration.organizationId || !integration.stallId) return response({ error: "NOT_FOUND" }, 404, requestId);

  const settings = lineIntegrationSettingsSchema.safeParse(integration.settingsJson);
  const [binding] = await prisma.$queryRaw<Array<{ sender_scope: string; provider_id: string | null; oa_destination: string | null }>>`
    select sender_scope,provider_id,oa_destination from public.notification_integrations where id=${integration.id}::uuid`;
  if (!settings.success || !settings.data.webhookManagement?.messagingChannelId
    || binding?.sender_scope !== "LEGACY" || !binding.provider_id || !binding.oa_destination) {
    return response({ error: "MESSAGING_BINDING_REQUIRED" }, 404, requestId);
  }

  try {
    const secretValue = await readNotificationSecret(integration.secretReference);
    const secrets = lineIntegrationSecretsSchema.parse(JSON.parse(secretValue));
    if (!verifyLineWebhookSignature(
      rawBody,
      request.headers.get("x-line-signature"),
      secrets.messagingChannelSecret,
    )) {
      return response({ error: "INVALID_SIGNATURE" }, 401, requestId);
    }
    let webhookBody: unknown;
    try {
      webhookBody = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(rawBody));
    } catch {
      return response({ error: "INVALID_JSON" }, 400, requestId);
    }
    const parsed = lineWebhookBodySchema.safeParse(webhookBody);
    if (!parsed.success) return response({ error: "INVALID_EVENT" }, 400, requestId);
    if (parsed.data.destination !== binding.oa_destination) return response({ error: "DESTINATION_MISMATCH" }, 403, requestId);

    const revokedCount = await prisma.$transaction(async transaction => {
      const [current] = await transaction.$queryRaw<Array<{ organization_id: string; stall_id: string; secret_reference: string | null; settings_json: unknown; status: string; provider: string; sender_scope: string; provider_id: string | null; oa_destination: string | null }>>`
        select organization_id,stall_id,secret_reference,settings_json,status,provider,sender_scope,provider_id,oa_destination
        from public.notification_integrations where id=${integration.id}::uuid for update`;
      const currentSettings = lineIntegrationSettingsSchema.safeParse(current?.settings_json);
      if (!current || current.status !== "ACTIVE" || current.provider !== "LINE" || current.sender_scope !== "LEGACY"
        || current.organization_id !== integration.organizationId || current.stall_id !== integration.stallId
        || current.secret_reference !== integration.secretReference || current.provider_id !== binding.provider_id
        || current.oa_destination !== binding.oa_destination || !currentSettings.success
        || currentSettings.data.webhookManagement?.messagingChannelId !== settings.data.webhookManagement?.messagingChannelId) return null;
      let count = 0;
      for (const event of parsed.data.events) {
        const providerEventHash = hashToken(`${integration.id}:${event.webhookEventId ?? JSON.stringify(event)}`);
        const stored = await transaction.lineWebhookEvent.createMany({
          data: [{ organizationId: integration.organizationId!, stallId: integration.stallId!, integrationId: integration.id,
            providerEventHash, eventType: event.type, processedAt: new Date() }],
          skipDuplicates: true,
        });
        if (stored.count && event.type === "unfollow" && event.source?.userId) {
          count += await revokeProviderContacts(transaction, integration.id, hashToken(event.source.userId));
        }
      }
      return count;
    });
    if (revokedCount === null) return response({ error: "MESSAGING_BINDING_CHANGED" }, 403, requestId);

    if (revokedCount > 0) {
      await recordAuditEvent({
        organizationId: integration.organizationId,
        stallId: integration.stallId!,
        action: "LINE_CONSENT_REVOKED",
        entityType: "NOTIFICATION_INTEGRATION",
        entityId: integration.id,
        outcome: "SUCCESS",
        requestId,
        ipHash,
        metadata: { source: "UNFOLLOW", revokedCount },
      });
    }
    return response({ ok: true }, 200, requestId);
  } catch {
    logEvent("error", "LINE_WEBHOOK_PROCESSING_FAILED", {
      requestId,
      integrationId,
    });
    return response({ error: "WEBHOOK_PROCESSING_FAILED" }, 500, requestId);
  }
}

async function revokeProviderContacts(transaction: Prisma.TransactionClient, integrationId: string, providerUserIdHash: string) {
  const links = await transaction.customerContactLink.findMany({
    where: { integrationId, provider: "LINE", providerUserIdHash, consentStatus: "GRANTED" },
    select: { id: true, providerUserSecretReference: true },
  });
  if (links.length === 0) return 0;
  const linkIds = links.map(link => link.id);
  await transaction.customerContactLink.updateMany({
    where: { id: { in: linkIds }, consentStatus: "GRANTED" },
    data: { consentStatus: "REVOKED", revokedAt: new Date() },
  });
  await transaction.$executeRaw`update public.notification_jobs j set status='CANCELLED',outcome='SUPPRESSED',
    next_attempt_at=null,last_error_code='CONSENT_REVOKED' where contact_link_id in (${Prisma.join(linkIds.map(id => Prisma.sql`${id}::uuid`))})
    and delivery_mode='LEGACY' and status in ('PENDING','FAILED') and outcome in ('QUEUED','RETRY_SCHEDULED')
    and first_request_at is null and legacy_intent_json is not null
    and not exists(select 1 from public.line_platform_order_owners owner where owner.order_id=j.order_id)`;
  await Promise.all(links.map(link => deleteNotificationSecret(link.providerUserSecretReference, transaction)));
  return links.length;
}

function response(body: unknown, status: number, requestId: string, retryAfter?: number) {
  return NextResponse.json(body, {
    status,
    headers: {
      "cache-control": "no-store",
      "x-request-id": requestId,
      ...(retryAfter ? { "retry-after": String(retryAfter) } : {}),
    },
  });
}
