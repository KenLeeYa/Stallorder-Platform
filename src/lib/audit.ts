import "server-only";

import type { AuditOutcome, Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type AuditEvent = {
  organizationId?: string;
  action: string;
  entityType: string;
  outcome: AuditOutcome;
  requestId: string;
  stallId?: string;
  actorProfileId?: string;
  entityId?: string;
  ipHash?: string;
  metadata?: Record<string, string | number | boolean | null>;
  before?: Prisma.InputJsonObject;
  after?: Prisma.InputJsonObject;
};

function cleanMetadata(metadata: AuditEvent["metadata"]) {
  if (!metadata) return null;
  const cleaned = Object.fromEntries(
    Object.entries(metadata).map(([key, value]) => [
      key.slice(0, 80),
      typeof value === "string" ? value.replace(/[\r\n]/g, " ").slice(0, 200) : value,
    ]),
  );
  return JSON.stringify(cleaned);
}

export function logEvent(
  level: "info" | "warn" | "error",
  event: string,
  fields: Record<string, string | number | boolean | null | undefined>,
) {
  const record = { timestamp: new Date().toISOString(), level, event, ...fields };
  const output = JSON.stringify(record);
  if (level === "error") console.error(output);
  else if (level === "warn") console.warn(output);
  else console.info(output);
}

export async function recordAuditEvent(event: AuditEvent) {
  try {
    const organizationId = event.organizationId ?? (event.stallId
      ? (await prisma.stall.findUnique({
        where: { id: event.stallId },
        select: { organizationId: true },
      }))?.organizationId
      : undefined);
    await prisma.auditLog.create({
      data: {
        action: event.action,
        organizationId,
        entityType: event.entityType,
        outcome: event.outcome,
        requestId: event.requestId,
        stallId: event.stallId,
        actorProfileId: event.actorProfileId,
        entityId: event.entityId,
        ipHash: event.ipHash,
        metadata: cleanMetadata(event.metadata),
        beforeJson: event.before,
        afterJson: event.after,
      },
    });
    logEvent(event.outcome === "SUCCESS" ? "info" : "warn", event.action, {
      requestId: event.requestId,
      outcome: event.outcome,
      stallId: event.stallId,
      actorProfileId: event.actorProfileId,
      entityId: event.entityId,
    });
  } catch {
    logEvent("error", "AUDIT_WRITE_FAILED", {
      requestId: event.requestId,
      action: event.action,
    });
  }
}
