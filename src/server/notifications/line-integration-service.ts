import "server-only";

import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import {
  lineIntegrationSecretsSchema,
  lineIntegrationSettingsSchema,
  type LineNotificationTemplateCode,
} from "@/lib/line-notification-contract";
import { prisma } from "@/lib/prisma";
import { entitlementService } from "@/server/billing/entitlement-service";
import {
  deleteNotificationSecret,
  storeNotificationSecret,
} from "./notification-secrets";

export async function getLineIntegrationManagerData(organizationId: string, stallId: string) {
  await entitlementService.assertFeatureIncluded(organizationId, "LINE_NOTIFICATIONS");
  const integration = await prisma.notificationIntegration.findFirst({
    where: { organizationId, stallId, provider: "LINE" },
  });
  const settings = integration
    ? lineIntegrationSettingsSchema.safeParse(integration.settingsJson)
    : null;
  return {
    configured: Boolean(integration?.secretReference),
    integrationId: integration?.id ?? null,
    status: integration?.status ?? "DISABLED",
    channelId: integration?.publicIdentifier ?? "",
    settings: settings?.success ? settings.data : {
      displayName: "LINE 取餐通知",
      officialAccountUrl: "",
      notifyConfirmed: true,
      notifyReady: true,
      notifyCancelled: true,
    },
    updatedAt: integration?.updatedAt.toISOString() ?? null,
  };
}
export async function upsertLineIntegration(input: {
  organizationId: string;
  stallId: string;
  channelId: string;
  channelAccessToken: string;
  messagingChannelSecret: string;
  loginChannelSecret: string;
  settings: {
    displayName: string;
    officialAccountUrl: string;
    notifyConfirmed: boolean;
    notifyReady: boolean;
    notifyCancelled: boolean;
  };
}) {
  await entitlementService.assertFeatureEnabled(input.organizationId, "LINE_NOTIFICATIONS");
  await entitlementService.assertFeatureIncluded(input.organizationId, "LINE_ORDER_LINKING");
  const secrets = lineIntegrationSecretsSchema.parse({
    channelAccessToken: input.channelAccessToken,
    messagingChannelSecret: input.messagingChannelSecret,
    loginChannelSecret: input.loginChannelSecret,
  });
  const settings = lineIntegrationSettingsSchema.parse(input.settings);
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.notificationIntegration.findFirst({
      where: { organizationId: input.organizationId, stallId: input.stallId, provider: "LINE" },
    });
    const integrationId = current?.id ?? randomUUID();
    const secretReference = await storeNotificationSecret(
      `stallorder_line_integration_${integrationId.replaceAll("-", "_")}_${Date.now()}`,
      JSON.stringify(secrets),
      "StallOrder LINE integration credentials",
      transaction,
    );
    const integration = current
      ? await transaction.notificationIntegration.update({
        where: { id: current.id },
        data: {
          status: "ACTIVE",
          publicIdentifier: input.channelId,
          secretReference,
          settingsJson: settings as unknown as Prisma.InputJsonObject,
        },
      })
      : await transaction.notificationIntegration.create({
        data: {
          id: integrationId,
          organizationId: input.organizationId,
          stallId: input.stallId,
          provider: "LINE",
          status: "ACTIVE",
          publicIdentifier: input.channelId,
          secretReference,
          settingsJson: settings as unknown as Prisma.InputJsonObject,
        },
      });
    await deleteNotificationSecret(current?.secretReference ?? null, transaction);
    return integration;
  });
}

export async function disableLineIntegration(organizationId: string, stallId: string) {
  await entitlementService.assertFeatureIncluded(organizationId, "LINE_NOTIFICATIONS");
  return prisma.$transaction(async (transaction) => {
    const integration = await transaction.notificationIntegration.findFirst({
      where: { organizationId, stallId, provider: "LINE" },
    });
    if (!integration) return null;
    await transaction.notificationJob.updateMany({
      where: { integrationId: integration.id, status: { in: ["PENDING", "FAILED"] } },
      data: { status: "CANCELLED", nextAttemptAt: null, lastErrorCode: "INTEGRATION_DISABLED" },
    });
    const updated = await transaction.notificationIntegration.update({
      where: { id: integration.id },
      data: { status: "DISABLED", publicIdentifier: null, secretReference: null },
    });
    await deleteNotificationSecret(integration.secretReference, transaction);
    return updated;
  });
}

export function lineTemplateEnabled(
  settings: unknown,
  templateCode: LineNotificationTemplateCode,
) {
  const parsed = lineIntegrationSettingsSchema.safeParse(settings);
  if (!parsed.success) return false;
  return templateCode === "ORDER_CONFIRMED"
    ? parsed.data.notifyConfirmed
    : templateCode === "ORDER_READY"
      ? parsed.data.notifyReady
      : templateCode === "FULFILLMENT_TIME_PROPOSED"
        ? parsed.data.notifyConfirmed
        : parsed.data.notifyCancelled;
}
