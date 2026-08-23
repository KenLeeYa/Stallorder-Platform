import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { getPaymentProviderDefinition } from "./provider-definitions";
import { getPaymentProviderAdapter } from "./provider-registry";
import { MockPaymentProviderAdapter } from "./mock-adapter";
import { assertPaymentMockEnvironment } from "./runtime-policy";
import type { PaymentProviderCode } from "./types";

export const mockAcceptanceScenarios = [
  "SUCCESS_WEBHOOK_BEFORE_RETURN",
  "SUCCESS_RETURN_BEFORE_WEBHOOK",
  "PENDING",
  "FAILED",
  "EXPIRED",
  "FULL_REFUND",
  "RECONCILIATION_MISMATCH",
] as const;
export type MockAcceptanceScenario = (typeof mockAcceptanceScenarios)[number];

function sha256(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function assertMockPaymentRuntime(environment: NodeJS.ProcessEnv = process.env) {
  assertPaymentMockEnvironment(environment);
  if (environment.PAYMENT_PROVIDER_MODE?.trim().toLowerCase() !== "mock") {
    throw new Error("PAYMENT_MOCK_MODE_REQUIRED");
  }
}

export async function upsertLocalMockPaymentConnection(input: {
  organizationId: string;
  stallId: string | null;
  provider: PaymentProviderCode;
  enabledChannels: string[];
}) {
  assertMockPaymentRuntime();
  const definition = getPaymentProviderDefinition(input.provider);
  const where = {
    organizationId: input.organizationId,
    stallId: input.stallId,
    provider: input.provider,
    environment: "MOCK",
  };
  const existing = await prisma.paymentProviderConnection.findFirst({ where });
  const data = {
    connectionMode: definition.connectionMode,
    status: "READY",
    secretReference: "env://PAYMENT_MOCK_WEBHOOK_SECRET",
    merchantReference: "LOCAL-MOCK",
    capabilities: {
      synthetic: true,
      capabilities: definition.capabilities,
      liveBlocker: definition.liveBlocker,
    },
    enabledChannels: input.enabledChannels,
    lastVerifiedAt: new Date(),
    lastErrorCode: null,
  } satisfies Prisma.PaymentProviderConnectionUpdateInput;
  return existing
    ? prisma.paymentProviderConnection.update({ where: { id: existing.id }, data })
    : prisma.paymentProviderConnection.create({
      data: {
        ...where,
        connectionMode: definition.connectionMode,
        status: "READY",
        secretReference: "env://PAYMENT_MOCK_WEBHOOK_SECRET",
        merchantReference: "LOCAL-MOCK",
        capabilities: data.capabilities,
        enabledChannels: input.enabledChannels,
        lastVerifiedAt: new Date(),
      },
    });
}

export async function runLocalMockPaymentAcceptance(input: {
  organizationId: string;
  stallId: string;
  orderId: string;
  provider: PaymentProviderCode;
  scenario: MockAcceptanceScenario;
  idempotencyKey: string;
  requestId: string;
  actorProfileId: string;
}) {
  assertMockPaymentRuntime();
  const idempotencyKeyHash = sha256(input.idempotencyKey);
  const existing = await prisma.paymentProviderTransaction.findFirst({
    where: {
      organizationId: input.organizationId,
      stallId: input.stallId,
      provider: input.provider,
      idempotencyKeyHash,
    },
  });
  if (existing) {
    if (existing.orderId !== input.orderId) throw new Error("PAYMENT_IDEMPOTENCY_CONFLICT");
    return serialize(existing, { idempotentReplay: true });
  }

  const [order, connection] = await Promise.all([
    prisma.order.findFirst({
      where: {
        id: input.orderId,
        organizationId: input.organizationId,
        stallId: input.stallId,
        paymentStatus: "UNPAID",
      },
      select: { id: true, orderNo: true, total: true },
    }),
    prisma.paymentProviderConnection.findFirst({
      where: {
        organizationId: input.organizationId,
        OR: [{ stallId: input.stallId }, { stallId: null }],
        provider: input.provider,
        environment: "MOCK",
        status: { in: ["READY", "ACTIVE"] },
      },
      orderBy: { stallId: "desc" },
    }),
  ]);
  if (!order) throw new Error("PAYMENT_TEST_ORDER_NOT_UNPAID");
  if (!connection) throw new Error("PAYMENT_MOCK_CONNECTION_NOT_READY");

  const definition = getPaymentProviderDefinition(input.provider);
  const adapter = getPaymentProviderAdapter({
    provider: input.provider,
    environment: "MOCK",
  });
  if (!(adapter instanceof MockPaymentProviderAdapter)) {
    throw new Error("PAYMENT_MOCK_ADAPTER_REQUIRED");
  }
  const mockScenario = input.scenario === "FAILED"
    ? "FAILED" as const
    : input.scenario === "EXPIRED"
      ? "EXPIRED" as const
      : input.scenario === "PENDING"
        ? "PENDING" as const
        : "SUCCESS" as const;
  const created = await adapter.createPaymentSession({
    merchantOrderId: `${input.stallId}:${order.orderNo}`,
    amount: order.total,
    currency: "TWD",
    idempotencyKey: input.idempotencyKey,
    returnUrl: "https://mock.invalid/payment/return",
    cancelUrl: "https://mock.invalid/payment/cancel",
    mockScenario,
  });
  let transaction = await prisma.paymentProviderTransaction.create({
    data: {
      organizationId: input.organizationId,
      stallId: input.stallId,
      orderId: order.id,
      providerConnectionId: connection.id,
      provider: input.provider,
      providerTransactionId: created.providerTransactionId,
      merchantOrderId: `${input.stallId}:${order.orderNo}`,
      amount: order.total,
      currency: "TWD",
      status: created.status,
      providerStatus: created.providerStatus,
      expiresAt: created.expiresAt ? new Date(created.expiresAt) : null,
      idempotencyKeyHash,
      metadata: {
        synthetic: true,
        scenario: input.scenario,
        browserReturnTrusted: false,
      },
    },
  });

  if (input.scenario === "FAILED" || input.scenario === "EXPIRED") {
    transaction = await prisma.paymentProviderTransaction.update({
      where: { id: transaction.id },
      data: input.scenario === "FAILED"
        ? { status: "FAILED", failedAt: new Date(), lastVerifiedAt: new Date() }
        : { status: "EXPIRED", lastVerifiedAt: new Date() },
    });
    return serialize(transaction, { idempotentReplay: false });
  }

  if (input.scenario === "PENDING") {
    const queried = await adapter.completeCustomerAction(created.providerTransactionId, "PENDING");
    transaction = await prisma.paymentProviderTransaction.update({
      where: { id: transaction.id },
      data: {
        status: queried.status,
        providerStatus: queried.providerStatus,
        browserReturnedAt: new Date(),
        lastVerifiedAt: new Date(),
      },
    });
    return serialize(transaction, {
      idempotentReplay: false,
      browserReturnTrusted: false,
    });
  }

  if (input.scenario === "SUCCESS_RETURN_BEFORE_WEBHOOK") {
    transaction = await prisma.paymentProviderTransaction.update({
      where: { id: transaction.id },
      data: { browserReturnedAt: new Date() },
    });
  }
  const webhook = adapter.createSignedWebhook({
    providerTransactionId: created.providerTransactionId,
    status: "PAID",
  });
  const verified = await adapter.verifyWebhook(webhook);
  const duplicate = await adapter.verifyWebhook(webhook);
  await prisma.paymentProviderWebhookEvent.upsert({
    where: {
      provider_externalEventId: {
        provider: input.provider,
        externalEventId: verified.externalEventId,
      },
    },
    create: {
      organizationId: input.organizationId,
      stallId: input.stallId,
      providerConnectionId: connection.id,
      transactionId: transaction.id,
      provider: input.provider,
      externalEventId: verified.externalEventId,
      bodyHash: verified.bodyHash,
      signatureValid: true,
      processedAt: new Date(),
      processingStatus: "APPLIED",
      attemptCount: duplicate.duplicate ? 2 : 1,
    },
    update: { attemptCount: { increment: 1 } },
  });

  transaction = await materializeTrustedMockPayment({
    transactionId: transaction.id,
    providerStatus: verified.providerStatus,
    providerLabel: definition.label,
    requestId: input.requestId,
    actorProfileId: input.actorProfileId,
    browserReturnedAt: input.scenario === "SUCCESS_WEBHOOK_BEFORE_RETURN"
      ? new Date()
      : transaction.browserReturnedAt,
  });

  if (input.scenario === "FULL_REFUND") {
    const refund = await adapter.refundPayment({
      providerTransactionId: created.providerTransactionId,
      amount: order.total,
      currency: "TWD",
      reason: "LOCAL_MOCK_ACCEPTANCE",
      idempotencyKey: `${input.idempotencyKey}:refund`,
    });
    transaction = await prisma.$transaction(async (database) => {
      await database.paymentProviderRefund.create({
        data: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          transactionId: transaction.id,
          requestedByProfileId: input.actorProfileId,
          requestedAmount: order.total,
          currency: "TWD",
          reason: "LOCAL_MOCK_ACCEPTANCE",
          providerRefundId: refund.providerRefundId,
          status: "SUCCEEDED",
          idempotencyKeyHash: sha256(`${input.idempotencyKey}:refund`),
          processedAt: new Date(),
        },
      });
      await database.payment.updateMany({
        where: { orderId: order.id, status: "PAID" },
        data: { status: "REFUNDED", reconciliationStatus: "RECONCILED" },
      });
      await database.order.updateMany({
        where: { id: order.id, paymentStatus: "PAID" },
        data: { paymentStatus: "REFUNDED" },
      });
      return database.paymentProviderTransaction.update({
        where: { id: transaction.id },
        data: { status: "REFUNDED", refundedAt: new Date(), providerStatus: refund.providerStatus },
      });
    });
  }

  if (input.scenario === "RECONCILIATION_MISMATCH") {
    const reconciliation = await adapter.reconcile({
      providerTransactionId: created.providerTransactionId,
      expectedAmount: order.total + 1,
      expectedCurrency: "TWD",
      expectedStatus: "PAID",
    });
    await prisma.paymentReconciliationCase.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        transactionId: transaction.id,
        provider: input.provider,
        caseType: reconciliation.mismatchCodes.includes("AMOUNT_MISMATCH")
          ? "AMOUNT_MISMATCH"
          : "STATUS_MISMATCH",
        expectedAmount: order.total + 1,
        actualAmount: order.total,
        currency: "TWD",
        providerReference: created.providerTransactionId,
        reviewStatus: "OPEN",
        safeNotes: reconciliation.mismatchCodes.join(","),
      },
    });
    transaction = await prisma.paymentProviderTransaction.update({
      where: { id: transaction.id },
      data: { status: "RECONCILIATION_REQUIRED" },
    });
  }

  return serialize(transaction, {
    idempotentReplay: false,
    duplicateWebhookVerified: duplicate.duplicate,
    browserReturnTrusted: false,
  });
}

async function materializeTrustedMockPayment(input: {
  transactionId: string;
  providerStatus: string;
  providerLabel: string;
  requestId: string;
  actorProfileId: string;
  browserReturnedAt: Date | null;
}) {
  return prisma.$transaction(async (database) => {
    const transaction = await database.paymentProviderTransaction.findUniqueOrThrow({
      where: { id: input.transactionId },
      include: { order: true },
    });
    const existingPayment = await database.payment.findUnique({
      where: { orderId: transaction.orderId },
    });
    if (!existingPayment) {
      if (transaction.order.paymentStatus !== "UNPAID") {
        throw new Error("PAYMENT_ORDER_STATE_CONFLICT");
      }
      await database.payment.create({
        data: {
          organizationId: transaction.organizationId,
          stallId: transaction.stallId,
          orderId: transaction.orderId,
          paymentOptionId: transaction.paymentOptionId,
          amount: transaction.amount,
          method: "OTHER",
          status: "PAID",
          reference: `PROVIDER:${transaction.provider}:${transaction.providerTransactionId}`,
          methodLabel: input.providerLabel,
          reconciliationStatus: "RECONCILED",
          recordedById: input.actorProfileId,
          paidAt: new Date(),
        },
      });
      await database.order.update({
        where: { id: transaction.orderId },
        data: { paymentStatus: "PAID", paidAt: new Date() },
      });
    }
    const updated = await database.paymentProviderTransaction.update({
      where: { id: transaction.id },
      data: {
        status: "PAID",
        providerStatus: input.providerStatus,
        paidAt: transaction.paidAt ?? new Date(),
        browserReturnedAt: input.browserReturnedAt,
        lastVerifiedAt: new Date(),
      },
    });
    await database.auditLog.create({
      data: {
        organizationId: transaction.organizationId,
        stallId: transaction.stallId,
        actorProfileId: input.actorProfileId,
        action: "MOCK_PROVIDER_PAYMENT_VERIFIED",
        entityType: "PAYMENT_PROVIDER_TRANSACTION",
        entityId: transaction.id,
        outcome: "SUCCESS",
        requestId: input.requestId,
        metadata: JSON.stringify({
          provider: transaction.provider,
          amount: transaction.amount,
          currency: transaction.currency,
          synthetic: true,
          evidence: "SIGNED_WEBHOOK",
        }),
      },
    });
    return updated;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function serialize<T extends {
  id: string;
  orderId: string;
  provider: string;
  providerTransactionId: string | null;
  amount: number;
  currency: string;
  status: string;
  providerStatus: string | null;
  browserReturnedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}>(transaction: T, extra: Record<string, unknown>) {
  return {
    id: transaction.id,
    orderId: transaction.orderId,
    provider: transaction.provider,
    providerTransactionId: transaction.providerTransactionId,
    amount: transaction.amount,
    currency: transaction.currency,
    status: transaction.status,
    providerStatus: transaction.providerStatus,
    browserReturnedAt: transaction.browserReturnedAt?.toISOString() ?? null,
    createdAt: transaction.createdAt.toISOString(),
    updatedAt: transaction.updatedAt.toISOString(),
    ...extra,
  };
}
