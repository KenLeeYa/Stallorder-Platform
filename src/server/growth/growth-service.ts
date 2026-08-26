import "server-only";

import { prisma } from "@/lib/prisma";
import {
  assertGrowthCampaignTransition,
  type GrowthCommand,
} from "@/server/growth/growth-contract";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export class GrowthOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "GrowthOperationError";
  }
}

async function assertGrowthModuleEnabled(organizationId: string) {
  const flags = await resolveResilienceFeatureFlags(
    ["MODULE_GROWTH_ENABLED"],
    { organizationId, rolloutKey: organizationId },
  );
  if (!flags.MODULE_GROWTH_ENABLED.enabled) {
    throw new GrowthOperationError("GROWTH_MODULE_DISABLED");
  }
}

export async function getGrowthDashboard(organizationId: string) {
  await assertGrowthModuleEnabled(organizationId);
  const [campaigns, counts, crmFlag] = await Promise.all([
    prisma.growthCouponCampaign.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.$queryRaw<Array<{
      stampPrograms: number;
      referralPrograms: number;
      rfmSnapshots: number;
      automationFlows: number;
    }>>`
      select
        (select count(*)::integer from public.growth_stamp_programs where organization_id = ${organizationId}::uuid) as "stampPrograms",
        (select count(*)::integer from public.growth_referral_programs where organization_id = ${organizationId}::uuid) as "referralPrograms",
        (select count(*)::integer from public.growth_rfm_snapshots where organization_id = ${organizationId}::uuid) as "rfmSnapshots",
        (select count(*)::integer from public.growth_automation_flows where organization_id = ${organizationId}::uuid) as "automationFlows"
    `,
    resolveResilienceFeatureFlags(
      ["CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED"],
      { organizationId, rolloutKey: organizationId },
    ),
  ]);
  return {
    campaigns: campaigns.map((campaign) => ({
      id: campaign.id,
      name: campaign.name,
      discountType: campaign.discountType,
      discountValue: campaign.discountValue,
      budgetAmount: campaign.budgetAmount,
      redeemedAmount: campaign.redeemedAmount,
      perCustomerLimit: campaign.perCustomerLimit,
      minimumOrderAmount: campaign.minimumOrderAmount,
      startsAt: campaign.startsAt.toISOString(),
      endsAt: campaign.endsAt.toISOString(),
      channels: campaign.channels,
      status: campaign.status,
      issuedCount: campaign.issuedCount,
      redemptionCount: campaign.redemptionCount,
    })),
    counts: counts[0] ?? { stampPrograms: 0, referralPrograms: 0, rfmSnapshots: 0, automationFlows: 0 },
    customerActivationLocked: !crmFlag.CRM_LOYALTY_CONSENT_FOUNDATION_ENABLED.enabled,
  };
}

export async function applyGrowthCommand(input: {
  organizationId: string;
  actorProfileId: string;
  command: GrowthCommand;
}) {
  await assertGrowthModuleEnabled(input.organizationId);
  if (input.command.operation === "CREATE_COUPON_CAMPAIGN") {
    return prisma.growthCouponCampaign.create({
      data: {
        organizationId: input.organizationId,
        name: input.command.name,
        discountType: input.command.discountType,
        discountValue: input.command.discountValue,
        budgetAmount: input.command.budgetAmount,
        perCustomerLimit: input.command.perCustomerLimit,
        minimumOrderAmount: input.command.minimumOrderAmount,
        startsAt: new Date(input.command.startsAt),
        endsAt: new Date(input.command.endsAt),
        channels: input.command.channels,
        createdByProfileId: input.actorProfileId,
      },
    });
  }
  const campaign = await prisma.growthCouponCampaign.findFirst({
    where: { id: input.command.campaignId, organizationId: input.organizationId },
  });
  if (!campaign) throw new GrowthOperationError("GROWTH_CAMPAIGN_NOT_FOUND");
  try {
    assertGrowthCampaignTransition(campaign.status, input.command.status);
  } catch {
    throw new GrowthOperationError("GROWTH_CAMPAIGN_TRANSITION_INVALID");
  }
  return prisma.growthCouponCampaign.update({
    where: { id: campaign.id },
    data: { status: input.command.status },
  });
}
