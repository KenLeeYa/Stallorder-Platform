import "server-only";

import { prisma } from "@/lib/prisma";
import {
  assertEventCampaignTransition,
  type EventGrowthCommand,
} from "@/server/event-growth/event-growth-contract";
import {
  createEventAttributionToken,
  requireEventAttributionSecret,
} from "@/server/event-growth/event-attribution-token";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export class EventGrowthOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "EventGrowthOperationError";
  }
}

async function assertModuleEnabled(organizationId: string) {
  const flags = await resolveResilienceFeatureFlags(
    ["MODULE_EVENT_GROWTH_ENABLED"],
    { organizationId, rolloutKey: organizationId },
  );
  if (!flags.MODULE_EVENT_GROWTH_ENABLED.enabled) {
    throw new EventGrowthOperationError("EVENT_GROWTH_MODULE_DISABLED");
  }
}

export async function getEventGrowthDashboard(organizationId: string) {
  await assertModuleEnabled(organizationId);
  const [events, campaigns, expenses, metrics] = await Promise.all([
    prisma.marketEvent.findMany({
      where: { organizationId },
      orderBy: [{ startsAt: "desc" }, { name: "asc" }],
      take: 100,
      select: {
        id: true,
        name: true,
        startsAt: true,
        endsAt: true,
        qrCodes: {
          where: { state: "ACTIVE" },
          orderBy: { tokenVersion: "desc" },
          take: 1,
          select: { token: true },
        },
      },
    }),
    prisma.eventGrowthCampaign.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.eventGrowthExpense.findMany({
      where: { organizationId },
      orderBy: [{ incurredAt: "desc" }, { id: "desc" }],
      take: 100,
    }),
    prisma.$queryRaw<Array<{
      touchCount: number;
      attributedOrderCount: number;
      estimatedRevenueAmount: number;
      expenseAmount: number;
    }>>`
      select
        (select count(*)::integer from public.event_growth_touchpoints where organization_id = ${organizationId}::uuid) as "touchCount",
        (select count(*)::integer from public.event_growth_order_attributions where organization_id = ${organizationId}::uuid) as "attributedOrderCount",
        coalesce((select sum(estimated_revenue_amount)::integer from public.event_growth_order_attributions where organization_id = ${organizationId}::uuid), 0) as "estimatedRevenueAmount",
        coalesce((select sum(expense_amount)::integer from public.event_growth_expenses where organization_id = ${organizationId}::uuid), 0) as "expenseAmount"
    `,
  ]);
  const eventMap = new Map(events.map((event) => [event.id, event]));
  const nowEpochSeconds = Math.floor(Date.now() / 1000);
  const secret = requireEventAttributionSecret();
  return {
    events: events.map((event) => ({
      id: event.id,
      name: event.name,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      hasActiveOrderQr: event.qrCodes.length > 0,
    })),
    campaigns: campaigns.map((campaign) => {
      const event = eventMap.get(campaign.marketEventId);
      const expiry = Math.min(
        Math.floor(campaign.endsAt.getTime() / 1000),
        nowEpochSeconds + 30 * 24 * 60 * 60,
      );
      const orderPath = event?.qrCodes[0] && expiry > nowEpochSeconds && campaign.status !== "ENDED"
        ? `/q/${encodeURIComponent(event.qrCodes[0].token)}?event_attribution=${encodeURIComponent(createEventAttributionToken({ organizationId, marketEventId: campaign.marketEventId, campaignId: campaign.id, expiresAt: expiry }, secret))}`
        : null;
      return {
        id: campaign.id,
        marketEventId: campaign.marketEventId,
        eventName: event?.name ?? "已移除活動",
        name: campaign.name,
        source: campaign.source,
        medium: campaign.medium,
        campaignCode: campaign.campaignCode,
        startsAt: campaign.startsAt.toISOString(),
        endsAt: campaign.endsAt.toISOString(),
        status: campaign.status,
        orderPath,
      };
    }),
    expenses: expenses.map((expense) => ({
      id: expense.id,
      marketEventId: expense.marketEventId,
      eventName: eventMap.get(expense.marketEventId)?.name ?? "已移除活動",
      category: expense.category,
      amount: expense.expenseAmount,
      currency: expense.currency,
      note: expense.note,
      incurredAt: expense.incurredAt.toISOString(),
    })),
    summary: metrics[0] ?? { touchCount: 0, attributedOrderCount: 0, estimatedRevenueAmount: 0, expenseAmount: 0 },
    attributionCaptureEnabled: false,
  };
}

export async function applyEventGrowthCommand(input: {
  organizationId: string;
  actorProfileId: string;
  command: EventGrowthCommand;
}) {
  await assertModuleEnabled(input.organizationId);
  if (input.command.operation === "CREATE_CAMPAIGN" || input.command.operation === "CREATE_EXPENSE") {
    const event = await prisma.marketEvent.findFirst({
      where: { id: input.command.marketEventId, organizationId: input.organizationId },
      select: { id: true },
    });
    if (!event) throw new EventGrowthOperationError("EVENT_GROWTH_EVENT_NOT_FOUND");
  }
  if (input.command.operation === "CREATE_CAMPAIGN") {
    return prisma.eventGrowthCampaign.create({
      data: {
        organizationId: input.organizationId,
        marketEventId: input.command.marketEventId,
        name: input.command.name,
        source: input.command.source,
        medium: input.command.medium,
        campaignCode: input.command.campaignCode,
        startsAt: new Date(input.command.startsAt),
        endsAt: new Date(input.command.endsAt),
        createdByProfileId: input.actorProfileId,
      },
    });
  }
  if (input.command.operation === "CREATE_EXPENSE") {
    return prisma.eventGrowthExpense.create({
      data: {
        organizationId: input.organizationId,
        marketEventId: input.command.marketEventId,
        category: input.command.category,
        expenseAmount: input.command.amount,
        note: input.command.note,
        incurredAt: new Date(input.command.incurredAt),
        createdByProfileId: input.actorProfileId,
      },
    });
  }
  const campaign = await prisma.eventGrowthCampaign.findFirst({
    where: { id: input.command.campaignId, organizationId: input.organizationId },
  });
  if (!campaign) throw new EventGrowthOperationError("EVENT_GROWTH_CAMPAIGN_NOT_FOUND");
  try {
    assertEventCampaignTransition(campaign.status, input.command.status);
  } catch {
    throw new EventGrowthOperationError("EVENT_GROWTH_CAMPAIGN_TRANSITION_INVALID");
  }
  return prisma.eventGrowthCampaign.update({
    where: { id: campaign.id },
    data: { status: input.command.status },
  });
}
