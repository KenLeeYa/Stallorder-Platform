import "server-only";

import type { AuditOutcome } from "@prisma/client";
import { prisma } from "@/lib/prisma";

type AuditEvent = {
  tenantId?: string;
  action: string;
  entityType: string;
  outcome: AuditOutcome;
  requestId: string;
  stallId?: string;
  actorUserId?: string;
  entityId?: string;
  ipHash?: string;
  metadata?: Record<string, string | number | boolean | null>;
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
    const tenantId = event.tenantId ?? (event.stallId
      ? (await prisma.stall.findUnique({
        where: { id: event.stallId },
        select: { merchantId: true },
      }))?.merchantId
      : undefined);
    await prisma.auditLog.create({
      data: {
        action: event.action,
        tenantId,
        entityType: event.entityType,
        outcome: event.outcome,
        requestId: event.requestId,
        stallId: event.stallId,
        actorUserId: event.actorUserId,
        entityId: event.entityId,
        ipHash: event.ipHash,
        metadata: cleanMetadata(event.metadata),
      },
    });
    logEvent(event.outcome === "SUCCESS" ? "info" : "warn", event.action, {
      requestId: event.requestId,
      outcome: event.outcome,
      stallId: event.stallId,
      actorUserId: event.actorUserId,
      entityId: event.entityId,
    });
  } catch {
    logEvent("error", "AUDIT_WRITE_FAILED", {
      requestId: event.requestId,
      action: event.action,
    });
  }
}
