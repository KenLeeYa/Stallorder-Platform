import { expect } from "@playwright/test";
import type { PrismaClient } from "@prisma/client";

export async function waitForOwnedOrderRateWindow(prisma: PrismaClient, stallId: string, sessionRequestId: string) {
  const issuedAttempts = await prisma.publicOrderAttempt.findMany({
    where: { stallId, requestId: sessionRequestId, eventType: "SESSION_ISSUE", outcome: "ALLOWED" },
    select: { ipHash: true },
  });
  expect(issuedAttempts).toHaveLength(1);
  const ipHash = issuedAttempts[0].ipHash;
  expect(ipHash).toBeTruthy();
  const settings = await prisma.stallOrderingSettings.findUniqueOrThrow({
    where: { stallId },
    select: { maxOrdersPerWindow: true, orderWindowSeconds: true },
  });
  const checkedAt = new Date();
  const activeBuckets = await prisma.publicRateLimitBucket.findMany({
    where: { stallId, dimensionType: "ORDER_IP", dimensionHash: ipHash!, expiresAt: { gt: checkedAt } },
    select: { count: true, expiresAt: true },
  });
  expect(activeBuckets.length).toBeLessThanOrEqual(1);
  const bucket = activeBuckets[0];
  const waitedMs = bucket && bucket.count >= settings.maxOrdersPerWindow
    ? Math.max(0, bucket.expiresAt.getTime() - Date.now() + 1_000) : 0;
  expect(waitedMs).toBeLessThanOrEqual(settings.orderWindowSeconds * 1_000 + 1_000);
  const receipt = {
    checkedAt: checkedAt.toISOString(), count: bucket?.count ?? 0,
    limit: settings.maxOrdersPerWindow, expiresAt: bucket?.expiresAt.toISOString() ?? null, waitedMs,
  };
  if (waitedMs > 0) await new Promise((resolve) => setTimeout(resolve, waitedMs));
  return receipt;
}
