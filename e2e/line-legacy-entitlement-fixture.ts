import { randomUUID } from "node:crypto";
import type { PrismaClient } from "@prisma/client";

// Explicit compatibility qualification for this exact local test organization only.
// Never mutate a shared plan, feature flag, or Production entitlement.
export async function prepareLocalLegacyLineEntitlement(prisma: PrismaClient) {
  const target = new URL(process.env.DATABASE_URL ?? "");
  if (!["localhost", "127.0.0.1"].includes(target.hostname)
    || target.port !== (process.env.CI ? "54322" : "55722")) throw new Error("LOCAL_LEGACY_LINE_FIXTURE_REQUIRED");
  const organizationId = "11111111-1111-4111-8111-111111111111";
  const subscription = await prisma.subscription.findUniqueOrThrow({ where: { organizationId }, select: { id: true, planVersionId: true } });
  const code = `QA_LEGACY_LINE_${randomUUID().replaceAll("-", "").toUpperCase()}`;
  const addon = await prisma.addOnCatalog.create({ data: { code, displayName: "Local legacy LINE compatibility", billingType: "ONE_TIME", unitPrice: 0,
    featureCode: "LINE_NOTIFICATIONS", availabilityStatus: "ENABLED", isPublic: false, requiresManualApproval: false } });
  let itemId: string;
  try {
    itemId = (await prisma.subscriptionItem.create({ data: { organizationId, subscriptionId: subscription.id, itemType: "ADD_ON", code,
      description: "Local compatibility only; no payment", quantity: 1, unitPrice: 0, endsAt: new Date(Date.now() + 3600000) } })).id;
  } catch (error) { await prisma.addOnCatalog.delete({ where: { id: addon.id } }); throw error; }
  return async () => {
    const current = await prisma.subscription.findUniqueOrThrow({ where: { organizationId }, select: { id: true, planVersionId: true } });
    if (current.id !== subscription.id || current.planVersionId !== subscription.planVersionId) throw new Error("LEGACY_LINE_SUBSCRIPTION_CHANGED");
    await prisma.subscriptionItem.deleteMany({ where: { id: itemId, code, organizationId, subscriptionId: subscription.id } });
    await prisma.addOnCatalog.deleteMany({ where: { id: addon.id, code, isPublic: false } });
    if (await prisma.subscriptionItem.count({ where: { id: itemId } }) || await prisma.addOnCatalog.count({ where: { id: addon.id } })) throw new Error("LEGACY_LINE_FIXTURE_REMAINS");
  };
}
