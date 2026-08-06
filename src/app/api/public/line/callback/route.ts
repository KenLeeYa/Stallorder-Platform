import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import { createRequestId, hashClientIp, hashToken } from "@/lib/security";
import {
  lineIntegrationSecretsSchema,
  lineLinkEphemeralSecretSchema,
  type LineNotificationTemplateCode,
} from "@/lib/line-notification-contract";
import { entitlementService } from "@/server/billing/entitlement-service";
import { exchangeAndVerifyLineAuthorization } from "@/server/notifications/line-oauth";
import {
  deleteNotificationSecret,
  readNotificationSecret,
  storeNotificationSecret,
} from "@/server/notifications/notification-secrets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const requestId = createRequestId();
  const url = new URL(request.url);
  const state = url.searchParams.get("state") ?? "";
  const code = url.searchParams.get("code") ?? "";
  if (
    url.searchParams.has("error")
    || !/^[A-Za-z0-9_-]{40,200}$/.test(state)
    || code.length < 8
    || code.length > 2048
  ) {
    return lineLinkErrorResponse("LINE 授權未完成，請回到訂單頁重新操作。", requestId);
  }

  const stateHash = hashToken(state);
  const ipHash = hashClientIp(request);
  const limit = await checkRateLimit({
    scope: "line-oauth-callback",
    identifier: `${ipHash}:${stateHash}`,
    limit: 12,
    windowMs: 15 * 60_000,
  });
  if (!limit.allowed) {
    return lineLinkErrorResponse("操作過於頻繁，請稍後再試。", requestId, 429, limit.retryAfterSeconds);
  }

  let trackingToken = "";
  try {
    const session = await prisma.lineLinkSession.findFirst({
      where: { stateHash, status: "ACTIVE", expiresAt: { gt: new Date() } },
      include: { integration: true, order: true },
    });
    if (
      !session
      || session.integration.status !== "ACTIVE"
      || !session.integration.publicIdentifier
      || !session.integration.secretReference
    ) {
      return lineLinkErrorResponse("LINE 綁定已失效，請回到訂單頁重新操作。", requestId, 409);
    }

    await Promise.all([
      entitlementService.assertFeatureEnabled(session.organizationId, "LINE_NOTIFICATIONS"),
      entitlementService.assertFeatureEnabled(session.organizationId, "LINE_ORDER_LINKING"),
    ]);
    const [ephemeralValue, integrationValue] = await Promise.all([
      readNotificationSecret(session.ephemeralSecretReference),
      readNotificationSecret(session.integration.secretReference),
    ]);
    const ephemeral = lineLinkEphemeralSecretSchema.parse(JSON.parse(ephemeralValue));
    const integrationSecrets = lineIntegrationSecretsSchema.parse(JSON.parse(integrationValue));
    trackingToken = ephemeral.trackingToken;
    if (ephemeral.redirectUri !== `${url.origin}/api/public/line/callback`) {
      throw new Error("LINE_REDIRECT_URI_MISMATCH");
    }

    const identity = await exchangeAndVerifyLineAuthorization({
      code,
      channelId: session.integration.publicIdentifier,
      channelSecret: integrationSecrets.loginChannelSecret,
      redirectUri: ephemeral.redirectUri,
      codeVerifier: ephemeral.codeVerifier,
      nonce: ephemeral.nonce,
    });
    const now = new Date();
    await prisma.$transaction(async (transaction) => {
      const consumed = await transaction.lineLinkSession.updateMany({
        where: { id: session.id, status: "ACTIVE", expiresAt: { gt: now } },
        data: { status: "CONSUMED", consumedAt: now },
      });
      if (consumed.count !== 1) throw new Error("LINE_LINK_SESSION_REPLAYED");

      const previous = await transaction.customerContactLink.findUnique({
        where: {
          customerReferenceId_provider: {
            customerReferenceId: session.orderId,
            provider: "LINE",
          },
        },
        select: { providerUserSecretReference: true },
      });
      const recipientReference = await storeNotificationSecret(
        `stallorder_line_recipient_${session.orderId.replaceAll("-", "_")}_${Date.now()}`,
        JSON.stringify({ providerUserId: identity.providerUserId, trackingToken }),
        "StallOrder LINE notification recipient",
        transaction,
      );
      const contactLink = await transaction.customerContactLink.upsert({
        where: {
          customerReferenceId_provider: {
            customerReferenceId: session.orderId,
            provider: "LINE",
          },
        },
        create: {
          organizationId: session.organizationId,
          stallId: session.stallId,
          integrationId: session.integrationId,
          customerReferenceId: session.orderId,
          provider: "LINE",
          providerUserIdHash: hashToken(identity.providerUserId),
          providerUserSecretReference: recipientReference,
          consentStatus: "GRANTED",
          consentedAt: now,
        },
        update: {
          integrationId: session.integrationId,
          providerUserIdHash: hashToken(identity.providerUserId),
          providerUserSecretReference: recipientReference,
          consentStatus: "GRANTED",
          consentedAt: now,
          revokedAt: null,
        },
      });
      const templateCode = templateForStatus(session.order.status);
      if (templateCode) {
        await transaction.notificationJob.upsert({
          where: {
            orderId_provider_templateCode_eventVersion: {
              orderId: session.orderId,
              provider: "LINE",
              templateCode,
              eventVersion: 0,
            },
          },
          create: {
            organizationId: session.organizationId,
            stallId: session.stallId,
            integrationId: session.integrationId,
            contactLinkId: contactLink.id,
            orderId: session.orderId,
            provider: "LINE",
            templateCode,
            eventVersion: 0,
            recipientReference,
            status: "PENDING",
            nextAttemptAt: now,
          },
          update: {},
        });
      }
      await deleteNotificationSecret(previous?.providerUserSecretReference ?? null, transaction);
      await deleteNotificationSecret(session.ephemeralSecretReference, transaction);
    });

    await recordAuditEvent({
      organizationId: session.organizationId,
      stallId: session.stallId,
      action: "LINE_CONSENT_GRANTED",
      entityType: "ORDER",
      entityId: session.orderId,
      outcome: "SUCCESS",
      requestId,
      ipHash,
      metadata: { provider: "LINE" },
    });
    return NextResponse.redirect(orderUrl(url.origin, trackingToken, "linked"), 303);
  } catch {
    if (trackingToken) return NextResponse.redirect(orderUrl(url.origin, trackingToken, "error"), 303);
    return lineLinkErrorResponse("目前無法完成 LINE 綁定，請稍後再試。", requestId, 400);
  }
}

function templateForStatus(status: string): LineNotificationTemplateCode | null {
  if (status === "CONFIRMED") return "ORDER_CONFIRMED";
  if (status === "READY") return "ORDER_READY";
  if (status === "CANCELLED") return "ORDER_CANCELLED";
  return null;
}

function orderUrl(origin: string, trackingToken: string, result: "linked" | "error") {
  return new URL(`/order/${encodeURIComponent(trackingToken)}?line=${result}`, origin);
}

function lineLinkErrorResponse(message: string, requestId: string, status = 400, retryAfter?: number) {
  return NextResponse.json(
    { error: message, code: "LINE_LINK_FAILED" },
    {
      status,
      headers: {
        "cache-control": "no-store",
        "x-request-id": requestId,
        ...(retryAfter ? { "retry-after": String(retryAfter) } : {}),
      },
    },
  );
}
