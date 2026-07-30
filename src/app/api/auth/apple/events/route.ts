import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { revokeAllProfileSessions } from "@/lib/auth";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createRequestId,
  hashClientIp,
} from "@/lib/security";
import { hashOAuthEvidence } from "@/server/auth/oauth/crypto";
import { getEnabledOAuthProviderAdapter } from "@/server/auth/oauth/provider-registry";

const signedPayloadSchema = z.string().min(20).max(32_000);
const eventSchema = z.union([
  z.object({ payload: signedPayloadSchema }).strict()
    .transform((value) => value.payload),
  z.object({ signedPayload: signedPayloadSchema }).strict()
    .transform((value) => value.signedPayload),
]);

const revocationEvents = new Set([
  "consent-revoked",
  "account-deleted",
  "account-disabled",
  "credential-revoked",
]);

export async function POST(request: Request) {
  const requestId = createRequestId();
  let ipHash: string;
  try {
    ipHash = hashClientIp(request);
  } catch {
    return NextResponse.json(
      { error: "Unable to verify request source." },
      { status: 503, headers: { "x-request-id": requestId } },
    );
  }
  const limit = await checkRateLimit({
    scope: "oauth-apple-account-events",
    identifier: ipHash,
    limit: 120,
    windowMs: 60 * 60_000,
  });
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Too many requests." },
      {
        status: 429,
        headers: {
          "retry-after": String(limit.retryAfterSeconds),
          "x-request-id": requestId,
        },
      },
    );
  }
  const body = await readJson(request, requestId, { maxBytes: 36_000 });
  if (body.error) return body.error;
  const parsed = eventSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Invalid event." },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }

  let ledgerId: string | null = null;
  try {
    const adapter = await getEnabledOAuthProviderAdapter("APPLE");
    if (!adapter.verifyAccountEvent) throw new Error("OAUTH_ACCOUNT_EVENT_UNSUPPORTED");
    const event = await adapter.verifyAccountEvent(parsed.data);
    const eventHash = hashOAuthEvidence(parsed.data);
    const subjectHash = hashOAuthEvidence(event.subject);
    let ledger;
    try {
      ledger = await prisma.oAuthProviderEvent.create({
        data: {
          provider: "APPLE",
          eventHash,
          providerSubjectHash: subjectHash,
          eventType: event.eventType,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError
        && error.code === "P2002"
      ) {
        return NextResponse.json(
          { ok: true, duplicate: true },
          { headers: { "cache-control": "no-store", "x-request-id": requestId } },
        );
      }
      throw error;
    }
    ledgerId = ledger.id;

    await prisma.$transaction(async (transaction) => {
      const identity = await transaction.authIdentity.findUnique({
        where: {
          provider_providerSubject: {
            provider: "APPLE",
            providerSubject: event.subject,
          },
        },
      });
      if (!identity) {
        await transaction.oAuthProviderEvent.update({
          where: { id: ledger.id },
          data: { status: "IGNORED", processedAt: new Date() },
        });
        return;
      }
      const normalizedType = event.eventType.trim().toLowerCase();
      if (revocationEvents.has(normalizedType)) {
        await transaction.authIdentity.update({
          where: { id: identity.id },
          data: { revokedAt: new Date() },
        });
        await revokeAllProfileSessions(
          identity.profileId,
          "APPLE_ACCOUNT_EVENT",
          transaction,
        );
      }
      await transaction.auditLog.create({
        data: {
          actorProfileId: identity.profileId,
          action: "APPLE_ACCOUNT_EVENT_RECEIVED",
          entityType: "AUTH_IDENTITY",
          entityId: identity.id,
          outcome: "SUCCESS",
          requestId,
          ipHash,
          metadata: JSON.stringify({
            eventType: normalizedType,
            providerSubjectHash: subjectHash,
            sessionRevoked: revocationEvents.has(normalizedType),
            occurredAt: event.occurredAt.toISOString(),
          }),
        },
      });
      await transaction.oAuthProviderEvent.update({
        where: { id: ledger.id },
        data: { status: "PROCESSED", processedAt: new Date() },
      });
    });
    return NextResponse.json(
      { ok: true },
      { headers: { "cache-control": "no-store", "x-request-id": requestId } },
    );
  } catch {
    if (ledgerId) {
      await prisma.oAuthProviderEvent.updateMany({
        where: { id: ledgerId, status: "RECEIVED" },
        data: {
          status: "FAILED",
          failureCode: "PROCESSING_FAILED",
          processedAt: new Date(),
        },
      }).catch(() => undefined);
    }
    return NextResponse.json(
      { error: "Invalid event." },
      { status: 400, headers: { "x-request-id": requestId } },
    );
  }
}
