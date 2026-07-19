import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";

export const billingWorkflowErrorCodes = [
  "SUBSCRIPTION_NOT_FOUND",
  "SUBSCRIPTION_STATE_CONFLICT",
  "PLAN_VERSION_NOT_AVAILABLE",
  "RENEWAL_TOO_EARLY",
  "PLAN_CHANGE_ALREADY_PENDING",
  "ADDITIONAL_STALL_ALREADY_PENDING",
  "INVOICE_NOT_FOUND",
  "INVOICE_NOT_PAYABLE",
  "INVOICE_NOT_EDITABLE",
  "INVOICE_AMOUNT_MISMATCH",
  "INVOICE_HAS_PENDING_PAYMENT",
  "PAYMENT_NOT_FOUND",
  "PAYMENT_STATE_CONFLICT",
  "PAYMENT_IDEMPOTENCY_CONFLICT",
  "PAYMENT_AMOUNT_EXCEEDS_DUE",
  "UNPAID_INVOICE_EXISTS",
  "ORDER_PACKAGE_NOT_AVAILABLE",
  "ADD_ON_NOT_AVAILABLE",
  "REQUEST_NOT_FOUND",
  "REQUEST_STATE_CONFLICT",
] as const;

export type BillingWorkflowErrorCode = (typeof billingWorkflowErrorCodes)[number];

const workflowMessages: Record<BillingWorkflowErrorCode, string> = {
  SUBSCRIPTION_NOT_FOUND: "找不到此組織的訂閱。",
  SUBSCRIPTION_STATE_CONFLICT: "目前訂閱狀態無法執行此操作。",
  PLAN_VERSION_NOT_AVAILABLE: "指定方案版本目前不可使用。",
  RENEWAL_TOO_EARLY: "本期訂閱尚未到期，Phase 1 人工續約請於到期後建立帳單。",
  PLAN_CHANGE_ALREADY_PENDING: "已有一筆待審核的方案申請。",
  ADDITIONAL_STALL_ALREADY_PENDING: "已有一筆待審核的額外攤位申請。",
  INVOICE_NOT_FOUND: "找不到指定帳單。",
  INVOICE_NOT_PAYABLE: "此帳單目前不可提交付款。",
  INVOICE_NOT_EDITABLE: "此帳單已無法修改。",
  INVOICE_AMOUNT_MISMATCH: "帳單金額已變更，請重新確認。",
  INVOICE_HAS_PENDING_PAYMENT: "帳單仍有待確認付款，無法作廢。",
  PAYMENT_NOT_FOUND: "找不到指定付款紀錄。",
  PAYMENT_STATE_CONFLICT: "此付款紀錄已完成其他處理。",
  PAYMENT_IDEMPOTENCY_CONFLICT: "相同防重複識別已用於不同付款資料。",
  PAYMENT_AMOUNT_EXCEEDS_DUE: "付款金額不可超過帳單未付金額。",
  UNPAID_INVOICE_EXISTS: "仍有未結清帳單，無法直接恢復訂閱。",
  ORDER_PACKAGE_NOT_AVAILABLE: "此方案無法指派指定的訂單包。",
  ADD_ON_NOT_AVAILABLE: "指定加購項目目前不可使用。",
  REQUEST_NOT_FOUND: "找不到指定帳務申請。",
  REQUEST_STATE_CONFLICT: "此帳務申請已完成其他處理。",
};

export class BillingWorkflowError extends Error {
  constructor(readonly code: BillingWorkflowErrorCode) {
    super(workflowMessages[code]);
    this.name = "BillingWorkflowError";
  }
}

type AuditContext = {
  actorProfileId: string;
  requestId: string;
  ipHash?: string;
};

type ManualPaymentInput = {
  invoiceId: string;
  paymentMethod: "BANK_TRANSFER" | "CASH" | "LINE_PAY_MANUAL" | "OTHER";
  amount: number;
  referenceNumber?: string;
  bankLastFive?: string;
  receivedAt: Date;
  note?: string;
  idempotencyKey: string;
};

export class BillingWorkflowService {
  async requestPlanChange(
    organizationId: string,
    input: { planVersionId: string; billingInterval: "MONTHLY" | "ANNUAL"; reason: string },
    context: AuditContext,
  ) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const [subscription, planVersion] = await Promise.all([
          transaction.subscription.findUnique({ where: { organizationId } }),
          transaction.planVersion.findFirst({
            where: {
              id: input.planVersionId,
              isPublic: true,
              requiresQuote: false,
              effectiveFrom: { lte: new Date() },
              OR: [{ effectiveUntil: null }, { effectiveUntil: { gt: new Date() } }],
            },
            include: { plan: true },
          }),
        ]);
        if (!subscription) throw new BillingWorkflowError("SUBSCRIPTION_NOT_FOUND");
        if (!planVersion || planVersion.billingInterval === "TRIAL") {
          throw new BillingWorkflowError("PLAN_VERSION_NOT_AVAILABLE");
        }
        if (input.billingInterval === "ANNUAL" && planVersion.annualPrice === null) {
          throw new BillingWorkflowError("PLAN_VERSION_NOT_AVAILABLE");
        }

        const request = await transaction.billingChangeRequest.create({
          data: {
            organizationId,
            subscriptionId: subscription.id,
            requestType: "PLAN_CHANGE",
            requestedPlanVersionId: planVersion.id,
            requestedBillingInterval: input.billingInterval,
            reason: input.reason,
            requestedByProfileId: context.actorProfileId,
          },
        });
        await createAudit(transaction, organizationId, context, {
          action: "PLAN_CHANGE_REQUESTED",
          entityType: "BILLING_CHANGE_REQUEST",
          entityId: request.id,
          after: { planVersionId: planVersion.id, planCode: planVersion.plan.code, billingInterval: input.billingInterval },
        });
        return request;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new BillingWorkflowError("PLAN_CHANGE_ALREADY_PENDING");
      throw error;
    }
  }

  async requestAdditionalStalls(
    organizationId: string,
    input: { quantity: number; reason: string },
    context: AuditContext,
  ) {
    try {
      return await prisma.$transaction(async (transaction) => {
        const subscription = await transaction.subscription.findUnique({ where: { organizationId } });
        if (!subscription) throw new BillingWorkflowError("SUBSCRIPTION_NOT_FOUND");
        const request = await transaction.billingChangeRequest.create({
          data: {
            organizationId,
            subscriptionId: subscription.id,
            requestType: "ADDITIONAL_STALL",
            requestedQuantity: input.quantity,
            reason: input.reason,
            requestedByProfileId: context.actorProfileId,
          },
        });
        await createAudit(transaction, organizationId, context, {
          action: "ADDITIONAL_STALL_REQUESTED",
          entityType: "BILLING_CHANGE_REQUEST",
          entityId: request.id,
          after: { quantity: input.quantity },
        });
        return request;
      });
    } catch (error) {
      if (isUniqueViolation(error)) throw new BillingWorkflowError("ADDITIONAL_STALL_ALREADY_PENDING");
      throw error;
    }
  }

  async rejectBillingChangeRequest(requestId: string, note: string, context: AuditContext) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`select id from public.billing_change_requests where id = ${requestId}::uuid for update`;
      const request = await transaction.billingChangeRequest.findUnique({ where: { id: requestId } });
      if (!request) throw new BillingWorkflowError("REQUEST_NOT_FOUND");
      if (request.status !== "PENDING") throw new BillingWorkflowError("REQUEST_STATE_CONFLICT");
      const rejected = await transaction.billingChangeRequest.update({
        where: { id: request.id },
        data: {
          status: "REJECTED",
          decidedByProfileId: context.actorProfileId,
          decisionNote: note,
          decidedAt: new Date(),
        },
      });
      await createAudit(transaction, request.organizationId, context, {
        action: request.requestType === "PLAN_CHANGE" ? "PLAN_CHANGE_REJECTED" : "ADDITIONAL_STALL_REJECTED",
        entityType: "BILLING_CHANGE_REQUEST",
        entityId: request.id,
        before: { status: request.status },
        after: { status: rejected.status, decisionNoteLength: note.length },
      });
      await createNotification(transaction, request.organizationId, {
        type: "BILLING_REQUEST_REJECTED",
        severity: "WARNING",
        title: "帳務申請未通過",
        message: "帳務申請未通過平台審核，請至帳務頁查看狀態或重新送出。",
        entityType: "BILLING_CHANGE_REQUEST",
        entityId: request.id,
        dedupeKey: `billing-request-rejected:${request.id}`,
      });
      return rejected;
    });
  }

  async createPlanInvoice(
    input: {
      organizationId: string;
      planVersionId: string;
      billingInterval: "MONTHLY" | "ANNUAL";
      dueAt: Date;
      changeRequestId?: string;
    },
    context: AuditContext,
  ) {
    return prisma.$transaction(async (transaction) => {
      await lockSubscription(transaction, input.organizationId);
      const [subscription, version] = await Promise.all([
        transaction.subscription.findUnique({ where: { organizationId: input.organizationId } }),
        transaction.planVersion.findUnique({
          where: { id: input.planVersionId },
          include: { plan: true },
        }),
      ]);
      if (!subscription) throw new BillingWorkflowError("SUBSCRIPTION_NOT_FOUND");
      if (!version || version.billingInterval === "TRIAL") {
        throw new BillingWorkflowError("PLAN_VERSION_NOT_AVAILABLE");
      }
      const unitPrice = input.billingInterval === "ANNUAL" ? version.annualPrice : version.basePrice;
      if (unitPrice === null) throw new BillingWorkflowError("PLAN_VERSION_NOT_AVAILABLE");
      const now = new Date();
      if (isManualRenewalTooEarly(subscription, version.id, now)) {
        throw new BillingWorkflowError("RENEWAL_TOO_EARLY");
      }
      const period = billingPeriod(input.billingInterval, now);

      let invoice = await transaction.invoice.findUnique({
        where: {
          organizationId_billingPeriodStart_billingPeriodEnd: {
            organizationId: input.organizationId,
            billingPeriodStart: period.start,
            billingPeriodEnd: period.end,
          },
        },
      });
      if (invoice && !["DRAFT", "OPEN", "OVERDUE"].includes(invoice.status)) {
        throw new BillingWorkflowError("INVOICE_NOT_EDITABLE");
      }
      invoice ??= await transaction.invoice.create({
        data: {
          organizationId: input.organizationId,
          subscriptionId: subscription.id,
          status: "DRAFT",
          currency: version.currency,
          billingPeriodStart: period.start,
          billingPeriodEnd: period.end,
          dueAt: input.dueAt,
        },
      });
      if (invoice.currency !== version.currency) {
        throw new BillingWorkflowError("INVOICE_AMOUNT_MISMATCH");
      }

      await transaction.invoiceLineItem.deleteMany({
        where: { invoiceId: invoice.id, itemType: "BASE_PLAN" },
      });
      await transaction.invoiceLineItem.create({
        data: {
          organizationId: input.organizationId,
          invoiceId: invoice.id,
          itemType: "BASE_PLAN",
          code: version.plan.code,
          description: `${version.displayName} ${input.billingInterval === "ANNUAL" ? "年繳" : "月繳"}`,
          quantity: 1,
          unitPrice,
          subtotal: unitPrice,
          referenceId: version.id,
          metadataJson: { billingInterval: input.billingInterval },
        },
      });
      invoice = await transaction.invoice.update({
        where: { id: invoice.id },
        data: { status: "OPEN", issuedAt: invoice.issuedAt ?? new Date(), dueAt: input.dueAt },
      });

      if (input.changeRequestId) {
        const updated = await transaction.billingChangeRequest.updateMany({
          where: {
            id: input.changeRequestId,
            organizationId: input.organizationId,
            requestType: "PLAN_CHANGE",
            status: "PENDING",
            requestedPlanVersionId: version.id,
          },
          data: {
            status: "APPROVED",
            decidedByProfileId: context.actorProfileId,
            decidedAt: new Date(),
            decisionNote: "已建立人工付款帳單。",
            invoiceId: invoice.id,
          },
        });
        if (updated.count !== 1) throw new BillingWorkflowError("REQUEST_NOT_FOUND");
      }

      await createAudit(transaction, input.organizationId, context, {
        action: "INVOICE_CREATED",
        entityType: "INVOICE",
        entityId: invoice.id,
        after: { status: "OPEN", totalAmount: invoice.totalAmount, planVersionId: version.id, billingInterval: input.billingInterval },
      });
      await createNotification(transaction, input.organizationId, {
        type: "INVOICE_CREATED",
        title: "新帳單已建立",
        message: `帳單 ${invoice.invoiceNumber} 已建立，請於到期日前完成付款。`,
        entityType: "INVOICE",
        entityId: invoice.id,
        dedupeKey: `invoice-created:${invoice.id}`,
      });
      return invoice;
    });
  }

  async submitManualPayment(
    organizationId: string,
    input: ManualPaymentInput,
    context: AuditContext,
  ) {
    return prisma.$transaction(async (transaction) => {
      const existing = await transaction.manualPaymentRecord.findUnique({
        where: { organizationId_idempotencyKey: { organizationId, idempotencyKey: input.idempotencyKey } },
      });
      if (existing) {
        const matches = existing.invoiceId === input.invoiceId
          && existing.paymentMethod === input.paymentMethod
          && existing.amount === input.amount;
        if (!matches) throw new BillingWorkflowError("PAYMENT_IDEMPOTENCY_CONFLICT");
        return { payment: existing, idempotent: true };
      }

      await lockInvoice(transaction, input.invoiceId);
      const invoice = await transaction.invoice.findFirst({
        where: { id: input.invoiceId, organizationId },
      });
      if (!invoice) throw new BillingWorkflowError("INVOICE_NOT_FOUND");
      if (!["OPEN", "OVERDUE"].includes(invoice.status) || invoice.amountDue <= 0) {
        throw new BillingWorkflowError("INVOICE_NOT_PAYABLE");
      }
      if (input.amount > invoice.amountDue) {
        throw new BillingWorkflowError("PAYMENT_AMOUNT_EXCEEDS_DUE");
      }

      const payment = await transaction.manualPaymentRecord.create({
        data: {
          organizationId,
          invoiceId: invoice.id,
          paymentMethod: input.paymentMethod,
          amount: input.amount,
          currency: invoice.currency,
          referenceNumber: input.referenceNumber,
          bankLastFive: input.bankLastFive,
          receivedAt: input.receivedAt,
          recordedByProfileId: context.actorProfileId,
          note: input.note,
          idempotencyKey: input.idempotencyKey,
        },
      });
      await createAudit(transaction, organizationId, context, {
        action: "MANUAL_PAYMENT_SUBMITTED",
        entityType: "MANUAL_PAYMENT",
        entityId: payment.id,
        after: { invoiceId: invoice.id, paymentMethod: payment.paymentMethod, amount: payment.amount, status: payment.verificationStatus },
      });
      await createNotification(transaction, organizationId, {
        type: "PAYMENT_SUBMITTED",
        title: "付款資料已送出",
        message: `帳單 ${invoice.invoiceNumber} 的付款資料已送交平台確認。`,
        entityType: "MANUAL_PAYMENT",
        entityId: payment.id,
        dedupeKey: `payment-submitted:${payment.id}`,
      });
      return { payment, idempotent: false };
    });
  }

  async verifyManualPayment(paymentId: string, note: string, context: AuditContext) {
    return prisma.$transaction(async (transaction) => {
      await lockPayment(transaction, paymentId);
      const payment = await transaction.manualPaymentRecord.findUnique({ where: { id: paymentId } });
      if (!payment) throw new BillingWorkflowError("PAYMENT_NOT_FOUND");
      if (payment.verificationStatus === "VERIFIED") {
        const invoice = await transaction.invoice.findUniqueOrThrow({ where: { id: payment.invoiceId } });
        return { payment, invoice, subscriptionActivated: invoice.status === "PAID", idempotent: true };
      }
      if (payment.verificationStatus !== "PENDING_VERIFICATION") {
        throw new BillingWorkflowError("PAYMENT_STATE_CONFLICT");
      }

      await lockInvoice(transaction, payment.invoiceId);
      const invoice = await transaction.invoice.findUnique({ where: { id: payment.invoiceId } });
      if (!invoice) throw new BillingWorkflowError("INVOICE_NOT_FOUND");
      if (!["OPEN", "OVERDUE"].includes(invoice.status)) {
        throw new BillingWorkflowError("INVOICE_NOT_PAYABLE");
      }
      if (payment.currency !== invoice.currency || payment.amount > invoice.amountDue) {
        throw new BillingWorkflowError("INVOICE_AMOUNT_MISMATCH");
      }

      const amountPaid = invoice.amountPaid + payment.amount;
      const paid = amountPaid === invoice.totalAmount;
      const now = new Date();
      const verifiedPayment = await transaction.manualPaymentRecord.update({
        where: { id: payment.id },
        data: {
          verificationStatus: "VERIFIED",
          verifiedByProfileId: context.actorProfileId,
          verifiedAt: now,
        },
      });
      const updatedInvoice = await transaction.invoice.update({
        where: { id: invoice.id },
        data: {
          amountPaid,
          amountDue: invoice.totalAmount - amountPaid,
          status: paid ? "PAID" : invoice.status,
          paidAt: paid ? now : null,
        },
      });

      let subscriptionActivated = false;
      if (paid) {
        subscriptionActivated = await activateFromPaidInvoice(transaction, updatedInvoice, context);
      }
      await createAudit(transaction, payment.organizationId, context, {
        action: "MANUAL_PAYMENT_VERIFIED",
        entityType: "MANUAL_PAYMENT",
        entityId: payment.id,
        before: { status: payment.verificationStatus },
        after: { status: "VERIFIED", amount: payment.amount, invoiceStatus: updatedInvoice.status, reviewNoteLength: note.length },
      });
      await createNotification(transaction, payment.organizationId, {
        type: "PAYMENT_VERIFIED",
        title: "付款已確認",
        message: paid
          ? `帳單 ${invoice.invoiceNumber} 已付清，訂閱已啟用。`
          : `帳單 ${invoice.invoiceNumber} 已確認部分付款。`,
        entityType: "MANUAL_PAYMENT",
        entityId: payment.id,
        dedupeKey: `payment-verified:${payment.id}`,
      });
      return { payment: verifiedPayment, invoice: updatedInvoice, subscriptionActivated, idempotent: false };
    });
  }

  async rejectManualPayment(paymentId: string, note: string, context: AuditContext) {
    return prisma.$transaction(async (transaction) => {
      await lockPayment(transaction, paymentId);
      const payment = await transaction.manualPaymentRecord.findUnique({ where: { id: paymentId } });
      if (!payment) throw new BillingWorkflowError("PAYMENT_NOT_FOUND");
      if (payment.verificationStatus !== "PENDING_VERIFICATION") {
        throw new BillingWorkflowError("PAYMENT_STATE_CONFLICT");
      }
      const rejected = await transaction.manualPaymentRecord.update({
        where: { id: payment.id },
        data: {
          verificationStatus: "REJECTED",
          verifiedByProfileId: context.actorProfileId,
          rejectedAt: new Date(),
        },
      });
      await createAudit(transaction, payment.organizationId, context, {
        action: "MANUAL_PAYMENT_REJECTED",
        entityType: "MANUAL_PAYMENT",
        entityId: payment.id,
        before: { status: payment.verificationStatus },
        after: { status: "REJECTED", reviewNoteLength: note.length },
      });
      await createNotification(transaction, payment.organizationId, {
        type: "PAYMENT_REJECTED",
        severity: "WARNING",
        title: "付款資料未通過確認",
        message: "付款資料未通過平台確認，請檢查帳務頁面後重新提交。",
        entityType: "MANUAL_PAYMENT",
        entityId: payment.id,
        dedupeKey: `payment-rejected:${payment.id}`,
      });
      return rejected;
    });
  }

  async addInvoiceLine(
    invoiceId: string,
    input:
      | { itemType: "ADD_ON"; code: string; quantity: number; reason: string }
      | { itemType: "CUSTOM_SERVICE" | "CREDIT" | "DISCOUNT"; code: string; description: string; quantity: number; unitPrice: number; reason: string },
    context: AuditContext,
  ) {
    return prisma.$transaction(async (transaction) => {
      await lockInvoice(transaction, invoiceId);
      const invoice = await transaction.invoice.findUnique({ where: { id: invoiceId } });
      if (!invoice) throw new BillingWorkflowError("INVOICE_NOT_FOUND");
      if (!["DRAFT", "OPEN", "OVERDUE"].includes(invoice.status)) {
        throw new BillingWorkflowError("INVOICE_NOT_EDITABLE");
      }

      let code = input.code;
      let description: string;
      let unitPrice: number;
      let referenceId: string | undefined;
      if (input.itemType === "ADD_ON") {
        const catalog = await transaction.addOnCatalog.findFirst({
          where: {
            code: input.code,
            isActive: true,
            availabilityStatus: { in: ["ENABLED", "MANUAL_APPROVAL_REQUIRED"] },
          },
        });
        if (!catalog || catalog.code.startsWith("ORDER_PACKAGE_") || catalog.code.startsWith("ADDITIONAL_STALL_")) {
          throw new BillingWorkflowError("ADD_ON_NOT_AVAILABLE");
        }
        code = catalog.code;
        description = catalog.displayName;
        unitPrice = catalog.unitPrice;
        const item = await transaction.subscriptionItem.create({
          data: {
            organizationId: invoice.organizationId,
            subscriptionId: invoice.subscriptionId,
            itemType: "ADD_ON",
            referenceId: catalog.id,
            code: catalog.code,
            description: catalog.displayName,
            quantity: input.quantity,
            unitPrice: catalog.unitPrice,
            currency: catalog.currency,
            status: "PENDING",
          },
        });
        referenceId = item.id;
      } else {
        description = input.description;
        unitPrice = input.unitPrice;
      }

      const line = await transaction.invoiceLineItem.create({
        data: {
          organizationId: invoice.organizationId,
          invoiceId: invoice.id,
          itemType: input.itemType,
          code,
          description,
          quantity: input.quantity,
          unitPrice,
          subtotal: input.quantity * unitPrice,
          referenceId,
        },
      });
      const updatedInvoice = await transaction.invoice.update({
        where: { id: invoice.id },
        data: { status: "OPEN", issuedAt: invoice.issuedAt ?? new Date() },
      });
      await createAudit(transaction, invoice.organizationId, context, {
        action: input.itemType === "CREDIT" ? "CREDIT_ISSUED" : input.itemType === "ADD_ON" ? "ADD_ON_ASSIGNED" : "INVOICE_LINE_ADDED",
        entityType: "INVOICE_LINE_ITEM",
        entityId: line.id,
        before: { invoiceTotal: invoice.totalAmount },
        after: { invoiceId: invoice.id, itemType: input.itemType, code, quantity: input.quantity, unitPrice, invoiceTotal: updatedInvoice.totalAmount, reason: input.reason },
      });
      if (input.itemType === "CREDIT") {
        await createNotification(transaction, invoice.organizationId, {
          type: "CREDIT_ISSUED",
          title: "帳單折抵已建立",
          message: `帳單 ${invoice.invoiceNumber} 已加入折抵項目。`,
          entityType: "INVOICE",
          entityId: invoice.id,
          dedupeKey: `credit-issued:${line.id}`,
        });
      }
      return { line, invoice: updatedInvoice };
    });
  }

  async voidInvoice(invoiceId: string, reason: string, context: AuditContext) {
    return prisma.$transaction(async (transaction) => {
      await lockInvoice(transaction, invoiceId);
      const invoice = await transaction.invoice.findUnique({
        where: { id: invoiceId },
        include: { manualPayments: true, lineItems: true },
      });
      if (!invoice) throw new BillingWorkflowError("INVOICE_NOT_FOUND");
      if (!["DRAFT", "OPEN", "OVERDUE"].includes(invoice.status) || invoice.amountPaid > 0) {
        throw new BillingWorkflowError("INVOICE_NOT_EDITABLE");
      }
      if (invoice.manualPayments.some((payment) => payment.verificationStatus === "PENDING_VERIFICATION")) {
        throw new BillingWorkflowError("INVOICE_HAS_PENDING_PAYMENT");
      }
      const pendingItemIds = invoice.lineItems
        .filter((line) => line.itemType === "ADD_ON" && line.referenceId)
        .map((line) => line.referenceId as string);
      if (pendingItemIds.length > 0) {
        await transaction.subscriptionItem.updateMany({
          where: { id: { in: pendingItemIds }, status: "PENDING" },
          data: { status: "CANCELLED", endsAt: new Date() },
        });
      }
      const voided = await transaction.invoice.update({
        where: { id: invoice.id },
        data: { status: "VOID", voidedAt: new Date() },
      });
      await createAudit(transaction, invoice.organizationId, context, {
        action: "INVOICE_VOIDED",
        entityType: "INVOICE",
        entityId: invoice.id,
        before: { status: invoice.status, totalAmount: invoice.totalAmount },
        after: { status: voided.status, reason },
      });
      await createNotification(transaction, invoice.organizationId, {
        type: "INVOICE_VOIDED",
        severity: "WARNING",
        title: "帳單已作廢",
        message: `帳單 ${invoice.invoiceNumber} 已由平台管理員作廢。`,
        entityType: "INVOICE",
        entityId: invoice.id,
        dedupeKey: `invoice-voided:${invoice.id}`,
      });
      return voided;
    });
  }

  async transitionSubscription(
    subscriptionId: string,
    operation: "SUSPEND" | "REACTIVATE" | "ACTIVATE" | "EXTEND_TRIAL",
    input: { reason: string; days?: number },
    context: AuditContext,
  ) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`select id from public.subscriptions where id = ${subscriptionId}::uuid for update`;
      const subscription = await transaction.subscription.findUnique({ where: { id: subscriptionId } });
      if (!subscription) throw new BillingWorkflowError("SUBSCRIPTION_NOT_FOUND");
      const now = new Date();
      let data: Prisma.SubscriptionUpdateInput;
      let organizationStatus: "TRIALING" | "ACTIVE" | "SUSPENDED";
      let notificationType: string;

      if (operation === "SUSPEND") {
        if (subscription.status === "CANCELLED") throw new BillingWorkflowError("SUBSCRIPTION_STATE_CONFLICT");
        data = { status: "SUSPENDED", suspendedAt: now };
        organizationStatus = "SUSPENDED";
        notificationType = "SUBSCRIPTION_SUSPENDED";
      } else if (operation === "EXTEND_TRIAL") {
        if (!input.days || !subscription.trialEndsAt || !["TRIALING", "SUSPENDED"].includes(subscription.status)) {
          throw new BillingWorkflowError("SUBSCRIPTION_STATE_CONFLICT");
        }
        const base = subscription.trialEndsAt > now ? subscription.trialEndsAt : now;
        const trialEndsAt = new Date(base.getTime() + input.days * 86_400_000);
        data = { status: "TRIALING", trialEndsAt, billingPeriodEnd: dayStart(trialEndsAt), suspendedAt: null };
        organizationStatus = "TRIALING";
        notificationType = "TRIAL_EXTENDED";
      } else {
        if (operation === "REACTIVATE" && subscription.status !== "SUSPENDED") {
          throw new BillingWorkflowError("SUBSCRIPTION_STATE_CONFLICT");
        }
        const unpaid = await transaction.invoice.count({
          where: { subscriptionId, status: { in: ["OPEN", "OVERDUE"] }, amountDue: { gt: 0 } },
        });
        if (unpaid > 0) throw new BillingWorkflowError("UNPAID_INVOICE_EXISTS");
        data = {
          status: "ACTIVE",
          pastDueAt: null,
          gracePeriodEndsAt: null,
          suspendedAt: null,
          reactivatedAt: operation === "REACTIVATE" ? now : subscription.reactivatedAt,
        };
        organizationStatus = "ACTIVE";
        notificationType = operation === "REACTIVATE" ? "SUBSCRIPTION_REACTIVATED" : "SUBSCRIPTION_ACTIVATED";
      }

      const updated = await transaction.subscription.update({ where: { id: subscription.id }, data });
      await transaction.organization.update({
        where: { id: subscription.organizationId },
        data: { status: organizationStatus },
      });
      await createAudit(transaction, subscription.organizationId, context, {
        action: operation === "EXTEND_TRIAL" ? "TRIAL_EXTENDED" : notificationType,
        entityType: "SUBSCRIPTION",
        entityId: subscription.id,
        before: { status: subscription.status, trialEndsAt: subscription.trialEndsAt?.toISOString() ?? null },
        after: { status: updated.status, trialEndsAt: updated.trialEndsAt?.toISOString() ?? null, reason: input.reason },
      });
      await createNotification(transaction, subscription.organizationId, {
        type: notificationType,
        severity: operation === "SUSPEND" ? "CRITICAL" : "INFO",
        title: operation === "SUSPEND" ? "訂閱已停權" : operation === "EXTEND_TRIAL" ? "試用期已延長" : "訂閱已啟用",
        message: operation === "SUSPEND"
          ? "新訂單與新資源已停止建立；歷史與帳務資料仍可查看。"
          : "訂閱服務已更新，請重新整理工作區確認狀態。",
        entityType: "SUBSCRIPTION",
        entityId: subscription.id,
        dedupeKey: `${notificationType.toLowerCase()}:${subscription.id}:${now.toISOString()}`,
      });
      return updated;
    });
  }

  async assignOrderPackage(
    subscriptionId: string,
    input: { code: string; quantity: number; reason: string },
    context: AuditContext,
  ) {
    return prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`select id from public.subscriptions where id = ${subscriptionId}::uuid for update`;
      const [subscription, catalog] = await Promise.all([
        transaction.subscription.findUnique({ where: { id: subscriptionId }, include: { plan: true } }),
        transaction.addOnCatalog.findFirst({
          where: { code: input.code, isActive: true, availabilityStatus: "ENABLED" },
        }),
      ]);
      if (!subscription) throw new BillingWorkflowError("SUBSCRIPTION_NOT_FOUND");
      if (!catalog || !input.code.startsWith(`ORDER_PACKAGE_${subscription.plan.code}_`)) {
        throw new BillingWorkflowError("ORDER_PACKAGE_NOT_AVAILABLE");
      }
      const item = await transaction.subscriptionItem.create({
        data: {
          organizationId: subscription.organizationId,
          subscriptionId: subscription.id,
          itemType: "ORDER_PACKAGE",
          code: catalog.code,
          description: catalog.displayName,
          quantity: input.quantity,
          unitPrice: catalog.unitPrice,
          currency: catalog.currency,
          startsAt: new Date(),
          endsAt: subscription.billingPeriodEnd,
        },
      });
      const invoice = await editablePeriodInvoice(transaction, subscription, catalog.currency);
      await transaction.invoiceLineItem.create({
        data: {
          organizationId: subscription.organizationId,
          invoiceId: invoice.id,
          itemType: "ORDER_PACKAGE",
          code: catalog.code,
          description: catalog.displayName,
          quantity: input.quantity,
          unitPrice: catalog.unitPrice,
          subtotal: input.quantity * catalog.unitPrice,
          referenceId: item.id,
        },
      });
      const opened = await transaction.invoice.update({
        where: { id: invoice.id },
        data: { status: "OPEN", issuedAt: invoice.issuedAt ?? new Date() },
      });
      await createAudit(transaction, subscription.organizationId, context, {
        action: "ORDER_PACKAGE_ASSIGNED",
        entityType: "SUBSCRIPTION_ITEM",
        entityId: item.id,
        after: { code: catalog.code, quantity: input.quantity, invoiceId: invoice.id, reason: input.reason },
      });
      return { item, invoice: opened };
    });
  }

  async rebuildUsageSummary(subscriptionId: string, billingPeriod: Date, context: AuditContext) {
    return prisma.$transaction(async (transaction) => {
      const subscription = await transaction.subscription.findUnique({ where: { id: subscriptionId } });
      if (!subscription) throw new BillingWorkflowError("SUBSCRIPTION_NOT_FOUND");
      const result = await transaction.$queryRaw<Array<{ rebuild_billing_usage_summary: number }>>`
        select public.rebuild_billing_usage_summary(
          ${subscription.organizationId}::uuid,
          ${billingPeriod}::date,
          ${context.actorProfileId}::uuid,
          ${context.requestId}
        )
      `;
      return result[0]?.rebuild_billing_usage_summary ?? 0;
    });
  }
}

export const billingWorkflowService = new BillingWorkflowService();

export function billingWorkflowErrorFromUnknown(error: unknown) {
  if (error instanceof BillingWorkflowError) return error;
  const detail = error instanceof Error ? error.message : String(error ?? "");
  const code = billingWorkflowErrorCodes.find((candidate) => detail.includes(candidate));
  return code ? new BillingWorkflowError(code) : null;
}

export function billingPeriod(interval: "MONTHLY" | "ANNUAL", now: Date) {
  const start = dayStart(now);
  const end = addCalendarMonths(start, interval === "ANNUAL" ? 12 : 1);
  return { start, end };
}

export function isManualRenewalTooEarly(
  subscription: { status: string; planVersionId: string; billingPeriodEnd: Date },
  requestedPlanVersionId: string,
  now: Date,
) {
  return subscription.status === "ACTIVE"
    && subscription.planVersionId === requestedPlanVersionId
    && dayStart(subscription.billingPeriodEnd) > dayStart(now);
}

async function activateFromPaidInvoice(
  transaction: Prisma.TransactionClient,
  invoice: { id: string; organizationId: string; subscriptionId: string; billingPeriodStart: Date; billingPeriodEnd: Date },
  context: AuditContext,
) {
  await transaction.$queryRaw`select id from public.subscriptions where id = ${invoice.subscriptionId}::uuid for update`;
  const [subscription, baseLine] = await Promise.all([
    transaction.subscription.findUnique({ where: { id: invoice.subscriptionId } }),
    transaction.invoiceLineItem.findFirst({
      where: { invoiceId: invoice.id, itemType: "BASE_PLAN" },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  if (!subscription) throw new BillingWorkflowError("SUBSCRIPTION_NOT_FOUND");
  if (!baseLine?.referenceId) {
    await activatePendingInvoiceItems(transaction, invoice, context);
    return false;
  }
  const version = await transaction.planVersion.findUnique({ where: { id: baseLine.referenceId } });
  if (!version) throw new BillingWorkflowError("PLAN_VERSION_NOT_AVAILABLE");
  const metadata = asRecord(baseLine.metadataJson);
  const billingInterval = metadata?.billingInterval === "ANNUAL" ? "ANNUAL" : "MONTHLY";
  const now = new Date();

  await transaction.subscriptionItem.updateMany({
    where: { subscriptionId: subscription.id, itemType: "BASE_PLAN", status: "ACTIVE" },
    data: { status: "ENDED", endsAt: now },
  });
  await transaction.subscriptionItem.create({
    data: {
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      itemType: "BASE_PLAN",
      referenceId: version.id,
      code: baseLine.code,
      description: baseLine.description,
      quantity: 1,
      unitPrice: baseLine.unitPrice,
      currency: version.currency,
      status: "ACTIVE",
      startsAt: now,
    },
  });
  const previousStatus = subscription.status;
  await transaction.subscription.update({
    where: { id: subscription.id },
    data: {
      planId: version.planId,
      planVersionId: version.id,
      billingInterval,
      status: "ACTIVE",
      billingPeriodStart: invoice.billingPeriodStart,
      billingPeriodEnd: invoice.billingPeriodEnd,
      paymentDueAt: invoice.billingPeriodEnd,
      pastDueAt: null,
      gracePeriodEndsAt: null,
      suspendedAt: null,
      reactivatedAt: previousStatus === "SUSPENDED" ? now : subscription.reactivatedAt,
    },
  });
  await transaction.organization.update({
    where: { id: subscription.organizationId },
    data: { status: "ACTIVE" },
  });
  await createAudit(transaction, subscription.organizationId, context, {
    action: previousStatus === "SUSPENDED" ? "SUBSCRIPTION_REACTIVATED" : "SUBSCRIPTION_ACTIVATED",
    entityType: "SUBSCRIPTION",
    entityId: subscription.id,
    before: { status: previousStatus, planVersionId: subscription.planVersionId },
    after: { status: "ACTIVE", planVersionId: version.id, billingInterval },
  });
  await activatePendingInvoiceItems(transaction, invoice, context);
  return true;
}

async function activatePendingInvoiceItems(
  transaction: Prisma.TransactionClient,
  invoice: { id: string; organizationId: string; subscriptionId: string },
  context: AuditContext,
) {
  const lines = await transaction.invoiceLineItem.findMany({
    where: { invoiceId: invoice.id, itemType: "ADD_ON", referenceId: { not: null } },
    select: { referenceId: true },
  });
  const itemIds = lines.flatMap((line) => line.referenceId ? [line.referenceId] : []);
  if (itemIds.length === 0) return;
  const items = await transaction.subscriptionItem.findMany({
    where: { id: { in: itemIds }, subscriptionId: invoice.subscriptionId, status: "PENDING" },
  });
  const now = new Date();
  for (const item of items) {
    await transaction.subscriptionItem.update({
      where: { id: item.id },
      data: { status: "ACTIVE", startsAt: now },
    });
    await createAudit(transaction, invoice.organizationId, context, {
      action: "ADD_ON_ASSIGNED",
      entityType: "SUBSCRIPTION_ITEM",
      entityId: item.id,
      before: { status: item.status },
      after: { status: "ACTIVE", code: item.code, invoiceId: invoice.id },
    });
    await createNotification(transaction, invoice.organizationId, {
      type: "ADD_ON_ASSIGNED",
      title: "加購功能已啟用",
      message: `${item.description} 已在付款確認後啟用。`,
      entityType: "SUBSCRIPTION_ITEM",
      entityId: item.id,
      dedupeKey: `add-on-assigned:${item.id}`,
    });
  }
}

async function editablePeriodInvoice(
  transaction: Prisma.TransactionClient,
  subscription: { id: string; organizationId: string; billingPeriodStart: Date; billingPeriodEnd: Date; paymentDueAt: Date | null },
  currency: string,
) {
  let start = subscription.billingPeriodStart;
  let end = subscription.billingPeriodEnd;
  let invoice = await transaction.invoice.findUnique({
    where: { organizationId_billingPeriodStart_billingPeriodEnd: { organizationId: subscription.organizationId, billingPeriodStart: start, billingPeriodEnd: end } },
  });
  if (invoice && !["DRAFT", "OPEN", "OVERDUE"].includes(invoice.status)) {
    const duration = end.getTime() - start.getTime();
    start = end;
    end = new Date(end.getTime() + duration);
    invoice = await transaction.invoice.findUnique({
      where: { organizationId_billingPeriodStart_billingPeriodEnd: { organizationId: subscription.organizationId, billingPeriodStart: start, billingPeriodEnd: end } },
    });
  }
  if (invoice && !["DRAFT", "OPEN", "OVERDUE"].includes(invoice.status)) {
    throw new BillingWorkflowError("INVOICE_NOT_EDITABLE");
  }
  return invoice ?? transaction.invoice.create({
    data: {
      organizationId: subscription.organizationId,
      subscriptionId: subscription.id,
      status: "DRAFT",
      currency,
      billingPeriodStart: start,
      billingPeriodEnd: end,
      dueAt: subscription.paymentDueAt ?? end,
    },
  });
}

async function createNotification(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  input: {
    type: string;
    severity?: string;
    title: string;
    message: string;
    entityType: string;
    entityId: string;
    dedupeKey: string;
  },
) {
  const existing = await transaction.billingNotification.findFirst({
    where: { organizationId, dedupeKey: input.dedupeKey },
  });
  const notification = existing ?? await transaction.billingNotification.create({
    data: {
      organizationId,
      notificationType: input.type,
      severity: input.severity ?? "INFO",
      title: input.title,
      message: input.message,
      entityType: input.entityType,
      entityId: input.entityId,
      dedupeKey: input.dedupeKey,
    },
  });
  await transaction.notificationOutbox.upsert({
    where: { billingNotificationId_channel: { billingNotificationId: notification.id, channel: "IN_APP" } },
    update: {},
    create: {
      organizationId,
      billingNotificationId: notification.id,
      channel: "IN_APP",
      status: "PENDING",
    },
  });
}

async function createAudit(
  transaction: Prisma.TransactionClient,
  organizationId: string,
  context: AuditContext,
  event: {
    action: string;
    entityType: string;
    entityId: string;
    before?: Prisma.InputJsonObject;
    after?: Prisma.InputJsonObject;
  },
) {
  await transaction.auditLog.create({
    data: {
      organizationId,
      actorProfileId: context.actorProfileId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId,
      outcome: "SUCCESS",
      requestId: context.requestId,
      ipHash: context.ipHash,
      beforeJson: event.before,
      afterJson: event.after,
    },
  });
}

async function lockSubscription(transaction: Prisma.TransactionClient, organizationId: string) {
  await transaction.$queryRaw`select id from public.subscriptions where organization_id = ${organizationId}::uuid for update`;
}

async function lockInvoice(transaction: Prisma.TransactionClient, invoiceId: string) {
  await transaction.$queryRaw`select id from public.invoices where id = ${invoiceId}::uuid for update`;
}

async function lockPayment(transaction: Prisma.TransactionClient, paymentId: string) {
  await transaction.$queryRaw`select id from public.manual_payment_records where id = ${paymentId}::uuid for update`;
}

function dayStart(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function addCalendarMonths(value: Date, months: number) {
  const target = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(value.getUTCDate(), lastDay));
  return target;
}

function asRecord(value: Prisma.JsonValue | null) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, Prisma.JsonValue>
    : null;
}

function isUniqueViolation(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}
