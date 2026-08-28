import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { logEvent, recordAuditEvent } from "@/lib/audit";
import { lineIntegrationSecretsSchema, lineWebhookBodySchema } from "@/lib/line-notification-contract";
import { prisma } from "@/lib/prisma";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, hashToken } from "@/lib/security";
import { verifyLineWebhookSignature } from "@/server/notifications/line-security";
import { deleteNotificationSecret, readNotificationSecret } from "@/server/notifications/notification-secrets";
import {
  BoundedTextReadError,
  readBoundedText,
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

  let rawBody: string;
  try {
    rawBody = await readBoundedText(request, 64_000);
  } catch (error) {
    const status = error instanceof BoundedTextReadError
      && (error.reason === "BODY_TOO_LARGE" || error.reason === "INVALID_CONTENT_LENGTH")
      ? 413
      : 408;
    return response({ error: status === 413 ? "REQUEST_TOO_LARGE" : "REQUEST_TIMEOUT" }, status, requestId);
  }
  const integration = await prisma.notificationIntegration.findFirst({
    where: { id: integrationId, provider: "LINE", status: "ACTIVE" },
  });
  if (!integration?.secretReference) return response({ error: "NOT_FOUND" }, 404, requestId);

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
      webhookBody = JSON.parse(rawBody);
    } catch {
      return response({ error: "INVALID_JSON" }, 400, requestId);
    }
    const parsed = lineWebhookBodySchema.safeParse(webhookBody);
    if (!parsed.success) return response({ error: "INVALID_EVENT" }, 400, requestId);

    let revokedCount = 0;
    for (const event of parsed.data.events) {
      const providerEventHash = hashToken(`${integration.id}:${event.webhookEventId ?? JSON.stringify(event)}`);
      try {
        const storedEvent = await prisma.lineWebhookEvent.create({
          data: {
            organizationId: integration.organizationId,
            stallId: integration.stallId!,
            integrationId: integration.id,
            providerEventHash,
            eventType: event.type,
          },
        });
        if (event.type === "unfollow" && event.source?.userId) {
          revokedCount += await revokeProviderContacts(
            integration.id,
            hashToken(event.source.userId),
          );
        }
        await prisma.lineWebhookEvent.update({
          where: { id: storedEvent.id },
          data: { processedAt: new Date() },
        });
      } catch (error) {
        if (!isUniqueConstraint(error)) throw error;
      }
    }

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

async function revokeProviderContacts(integrationId: string, providerUserIdHash: string) {
  return prisma.$transaction(async (transaction) => {
    const links = await transaction.customerContactLink.findMany({
      where: { integrationId, provider: "LINE", providerUserIdHash, consentStatus: "GRANTED" },
      select: { id: true, providerUserSecretReference: true },
    });
    if (links.length === 0) return 0;
    const linkIds = links.map((link) => link.id);
    await transaction.customerContactLink.updateMany({
      where: { id: { in: linkIds }, consentStatus: "GRANTED" },
      data: { consentStatus: "REVOKED", revokedAt: new Date() },
    });
    await transaction.notificationJob.updateMany({
      where: { contactLinkId: { in: linkIds }, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "CANCELLED", nextAttemptAt: null, lastErrorCode: "CONSENT_REVOKED" },
    });
    await Promise.all(links.map((link) => deleteNotificationSecret(
      link.providerUserSecretReference,
      transaction,
    )));
    return links.length;
  });
}

function isUniqueConstraint(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
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
