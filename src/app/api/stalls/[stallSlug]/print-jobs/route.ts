import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import {
  createPrinterTestPayload,
  type PrintTicketPayload,
  type PrintPaperWidth,
} from "@/lib/kitchen-print-ticket";
import { MAX_PRINT_RULES_PER_STALL } from "@/lib/print-center-types";
import {
  getPrintQueueState,
  printQueueCommandSchema,
  reconcileStalePrintJobs,
} from "@/lib/print-queue";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";
import { entitlementErrorResponse } from "@/server/billing/entitlement-http";
import { entitlementService } from "@/server/billing/entitlement-service";
import {
  printJobTicketSelect,
  resolvePrintJobTicketPayload,
} from "@/server/printing/print-job-ticket";

type RouteContext = { params: Promise<{ stallSlug: string }> };
type Transaction = Prisma.TransactionClient;
type PrintQueueCommand = ReturnType<typeof printQueueCommandSchema.parse>;

class PrintQueueNotFoundError extends Error {}
class PrintQueueConflictError extends Error {
  constructor(readonly code = "PRINT_QUEUE_CONFLICT") {
    super(code);
  }
}

const capabilityGatedOperations = new Set<PrintQueueCommand["operation"]>([
  "REGISTER_PRINTER",
  "UPDATE_PRINTER",
  "TEST_PRINTER",
  "CREATE_RULE",
  "UPDATE_RULE",
  "DELETE_RULE",
  "QUEUE",
  "CLAIM",
  "REPRINT",
]);

const serializableOperations = new Set<PrintQueueCommand["operation"]>([
  "UPDATE_PRINTER",
  "CREATE_RULE",
  "UPDATE_RULE",
  "DELETE_RULE",
  "CLAIM",
]);

export async function GET(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_PRINT_QUEUE");
  if (!authorization.ok) return authorization.response;
  return NextResponse.json(
    { state: await getPrintQueueState(authorization.stall.id, authorization.stall.organizationId) },
    { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
  );
}

export async function POST(request: Request, context: RouteContext) {
  const { stallSlug } = await context.params;
  const authorization = await authorizeApiRequest(request, stallSlug, "MANAGE_PRINT_QUEUE");
  if (!authorization.ok) return authorization.response;
  if (!validateCsrf(request, authorization.principal)) {
    return NextResponse.json(
      { error: "安全驗證已失效，請重新整理後再試。" },
      { status: 403, headers: { "x-request-id": authorization.requestId } },
    );
  }
  const body = await readJson(request, authorization.requestId);
  if (body.error) return body.error;
  const parsed = printQueueCommandSchema.safeParse(body.data);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "列印工作資料格式不正確。" },
      { status: 400, headers: { "x-request-id": authorization.requestId } },
    );
  }

  const command = parsed.data;
  const organizationId = authorization.stall.organizationId;
  const stallId = authorization.stall.id;
  try {
    if (capabilityGatedOperations.has(command.operation)) {
      await entitlementService.assertFeatureEnabled(organizationId, "PRINTER_INTEGRATION");
      const settings = await prisma.stallOrderingSettings.findFirst({
        where: { organizationId, stallId },
        select: { printModuleEnabled: true },
      });
      if (!settings?.printModuleEnabled) {
        return NextResponse.json(
          { error: "列印模組目前未啟用。", code: "PRINT_MODULE_DISABLED" },
          { status: 409, headers: { "x-request-id": authorization.requestId } },
        );
      }
    }

    if (command.operation === "REFRESH") {
      await reconcileStalePrintJobs(stallId, organizationId);
      return NextResponse.json(
        { state: await getPrintQueueState(stallId, organizationId) },
        { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
      );
    }

    let printPayload: PrintTicketPayload | undefined;
    const transactionOptions = serializableOperations.has(command.operation)
      ? { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      : undefined;
    const entityId = await prisma.$transaction(async (transaction) => {
      if (command.operation === "REGISTER_PRINTER") {
        const printer = await transaction.printer.create({
          data: {
            organizationId,
            stallId,
            name: command.name,
            connectionType: command.connectionType,
            model: command.model,
            paperWidthMm: command.paperWidthMm,
          },
        });
        return printer.id;
      }
      if (command.operation === "UPDATE_PRINTER") {
        const printer = await findScopedPrinter(transaction, command.printerId, organizationId, stallId);
        const nextConnectionType = command.connectionType ?? printer.connectionType;
        const isDisabling = printer.isEnabled && !command.isEnabled;
        if (nextConnectionType !== printer.connectionType || isDisabling) {
          const inFlightJobs = await transaction.printJob.count({
            where: { organizationId, stallId, printerId: printer.id, status: "PRINTING" },
          });
          if (inFlightJobs > 0) throw new PrintQueueConflictError("PRINTER_HAS_IN_FLIGHT_JOBS");
        }
        if (nextConnectionType === "CLOUDPRNT") {
          const manualRules = await transaction.printRule.count({
            where: {
              organizationId,
              stallId,
              printerId: printer.id,
              deletedAt: null,
              isEnabled: true,
              autoPrint: false,
            },
          });
          if (manualRules > 0) throw new PrintQueueConflictError("CLOUDPRNT_MANUAL_RULES_EXIST");
        }
        await transaction.printer.update({
          where: { id: printer.id },
          data: {
            name: command.name,
            isEnabled: command.isEnabled,
            ...(command.connectionType ? { connectionType: command.connectionType } : {}),
            ...(command.model ? { model: command.model } : {}),
            ...(command.paperWidthMm ? { paperWidthMm: command.paperWidthMm } : {}),
          },
        });
        return printer.id;
      }
      if (command.operation === "HEARTBEAT") {
        const changed = await transaction.printer.updateMany({
          where: { id: command.printerId, organizationId, stallId, isEnabled: true },
          data: { lastSeenAt: new Date() },
        });
        if (changed.count !== 1) throw new PrintQueueNotFoundError();
        return command.printerId;
      }
      if (command.operation === "TEST_PRINTER") {
        const printer = await findScopedPrinter(transaction, command.printerId, organizationId, stallId);
        if (!printer.isEnabled) throw new PrintQueueConflictError();
        printPayload = createPrinterTestPayload({
          stallName: authorization.stall.name,
          printerName: printer.name,
          model: printer.model,
          connectionLabel: connectionLabel(printer.connectionType),
          paperWidthMm: normalizePaperWidth(printer.paperWidthMm),
          printedAt: new Date(),
          timeZone: authorization.stall.timezone,
        });
        return printer.id;
      }
      if (command.operation === "CREATE_RULE") {
        const ruleCount = await transaction.printRule.count({
          where: { organizationId, stallId, deletedAt: null },
        });
        if (ruleCount >= MAX_PRINT_RULES_PER_STALL) {
          throw new PrintQueueConflictError("PRINT_RULE_LIMIT_REACHED");
        }
        await assertRuleScope(transaction, command.rule, organizationId, stallId);
        const rule = await transaction.printRule.create({
          data: { organizationId, stallId, ...command.rule },
        });
        return rule.id;
      }
      if (command.operation === "UPDATE_RULE") {
        const existing = await transaction.printRule.findFirst({
          where: { id: command.ruleId, organizationId, stallId, deletedAt: null },
          select: { id: true },
        });
        if (!existing) throw new PrintQueueNotFoundError();
        await assertRuleScope(transaction, command.rule, organizationId, stallId);
        await transaction.printRule.update({
          where: { id: existing.id },
          data: command.rule,
        });
        return existing.id;
      }
      if (command.operation === "DELETE_RULE") {
        const existing = await transaction.printRule.findFirst({
          where: { id: command.ruleId, organizationId, stallId, deletedAt: null },
          select: { id: true },
        });
        if (!existing) throw new PrintQueueNotFoundError();
        await transaction.printJob.updateMany({
          where: {
            organizationId,
            stallId,
            printRuleId: existing.id,
            status: { in: ["PENDING", "FAILED"] },
          },
          data: { status: "CANCELLED", nextRetryAt: null },
        });
        await transaction.printRule.update({
          where: { id: existing.id },
          data: { isEnabled: false, deletedAt: new Date() },
        });
        return existing.id;
      }
      if (command.operation === "QUEUE") {
        const order = await transaction.order.findFirst({
          where: { id: command.orderId, organizationId, stallId },
          select: { id: true },
        });
        if (!order) throw new PrintQueueNotFoundError();
        const existing = await transaction.printJob.findFirst({
          where: { orderId: order.id, reprintOfId: null },
          select: { id: true },
        });
        if (existing) return existing.id;
        const configuredRules = await transaction.printRule.count({
          where: { organizationId, stallId, deletedAt: null },
        });
        if (configuredRules > 0) return order.id;
        const printer = await transaction.printer.findFirst({
          where: { organizationId, stallId, isEnabled: true },
          orderBy: [{ lastSeenAt: "desc" }, { createdAt: "asc" }],
        });
        const job = await transaction.printJob.create({
          data: {
            organizationId,
            stallId,
            orderId: order.id,
            printerId: printer?.id,
            requestedById: authorization.principal.user.id,
          },
        });
        return job.id;
      }

      const job = await transaction.printJob.findFirst({
        where: { id: command.jobId, organizationId, stallId },
      });
      if (!job) throw new PrintQueueNotFoundError();

      if (command.operation === "CLAIM") {
        const printer = await findScopedPrinter(transaction, command.printerId, organizationId, stallId);
        if (!printer.isEnabled || (job.printerId && job.printerId !== printer.id)) {
          throw new PrintQueueConflictError();
        }
        if (printer.connectionType === "CLOUDPRNT") {
          throw new PrintQueueConflictError("CLOUDPRNT_DEVICE_CLAIM_REQUIRED");
        }
        if (job.printRuleId) {
          const activeRule = await transaction.printRule.findFirst({
            where: {
              id: job.printRuleId,
              organizationId,
              stallId,
              deletedAt: null,
              isEnabled: true,
            },
            select: { id: true },
          });
          if (!activeRule) throw new PrintQueueConflictError("PRINT_RULE_INACTIVE");
        }
        const changed = await transaction.printJob.updateMany({
          where: { id: job.id, status: { in: ["PENDING", "FAILED"] }, attemptCount: { lt: job.maxAttempts } },
          data: {
            status: "PRINTING",
            printerId: printer.id,
            attemptCount: { increment: 1 },
            printingAt: new Date(),
            lastError: null,
            nextRetryAt: null,
          },
        });
        if (changed.count !== 1) throw new PrintQueueConflictError();
      } else if (command.operation === "SUCCESS") {
        const changed = await transaction.printJob.updateMany({
          where: { id: job.id, status: "PRINTING" },
          data: { status: "SUCCEEDED", printedAt: new Date(), lastError: null, nextRetryAt: null },
        });
        if (changed.count !== 1) throw new PrintQueueConflictError();
      } else if (command.operation === "FAIL") {
        const changed = await transaction.printJob.updateMany({
          where: { id: job.id, status: "PRINTING" },
          data: {
            status: "FAILED",
            lastError: command.error,
            nextRetryAt: job.attemptCount < job.maxAttempts ? new Date(Date.now() + 30_000) : null,
          },
        });
        if (changed.count !== 1) throw new PrintQueueConflictError();
      } else if (command.operation === "RETRY") {
        const changed = await transaction.printJob.updateMany({
          where: { id: job.id, status: "FAILED", attemptCount: { lt: job.maxAttempts } },
          data: { status: "PENDING", lastError: null, nextRetryAt: null, printingAt: null },
        });
        if (changed.count !== 1) throw new PrintQueueConflictError();
      } else if (command.operation === "REPRINT") {
        const assignedPrinter = job.printerId
          ? await transaction.printer.findFirst({ where: { id: job.printerId, organizationId, stallId, isEnabled: true } })
          : null;
        const fallbackPrinter = assignedPrinter ?? await transaction.printer.findFirst({
          where: { organizationId, stallId, isEnabled: true },
          orderBy: [{ lastSeenAt: "desc" }, { createdAt: "asc" }],
        });
        const reprint = await transaction.printJob.create({
          data: {
            organizationId,
            stallId,
            orderId: job.orderId,
            printerId: fallbackPrinter?.id,
            printRuleId: job.printRuleId,
            requestedById: authorization.principal.user.id,
            reprintOfId: job.id,
            documentType: job.documentType,
            copies: job.copies,
            payload: job.payload === null ? undefined : job.payload,
            templateVersion: job.templateVersion,
          },
        });
        return reprint.id;
      } else {
        const changed = await transaction.printJob.updateMany({
          where: { id: job.id, status: { in: ["PENDING", "FAILED"] } },
          data: { status: "CANCELLED", nextRetryAt: null },
        });
        if (changed.count !== 1) throw new PrintQueueConflictError();
      }
      return job.id;
    }, transactionOptions);

    if (command.operation === "CLAIM") {
      const claimedJob = await prisma.printJob.findFirst({
        where: {
          id: entityId,
          organizationId,
          stallId,
          printerId: command.printerId,
          status: "PRINTING",
        },
        select: {
          attemptCount: true,
          maxAttempts: true,
          ...printJobTicketSelect,
        },
      });
      if (!claimedJob) throw new PrintQueueConflictError();
      try {
        printPayload = await resolvePrintJobTicketPayload(claimedJob);
      } catch (error) {
        await prisma.printJob.updateMany({
          where: { id: entityId, organizationId, stallId, status: "PRINTING" },
          data: {
            status: "FAILED",
            lastError: "列印資料建立失敗",
            nextRetryAt: claimedJob.attemptCount < claimedJob.maxAttempts
              ? new Date(Date.now() + 30_000)
              : null,
          },
        });
        throw error;
      }
    }

    if (command.operation !== "HEARTBEAT") {
      await recordAuditEvent({
        organizationId,
        stallId,
        actorProfileId: authorization.principal.user.id,
        action: `PRINT_QUEUE_${command.operation}`,
        entityType: auditEntityType(command.operation),
        entityId,
        outcome: "SUCCESS",
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      });
    }
    return NextResponse.json(
      {
        state: await getPrintQueueState(stallId, organizationId),
        entityId,
        ...(printPayload ? { printPayload } : {}),
      },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const entitlementResponse = entitlementErrorResponse(error, authorization.requestId);
    if (entitlementResponse) return entitlementResponse;
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const serializationConflict = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034";
    const notFound = error instanceof PrintQueueNotFoundError;
    const conflict = error instanceof PrintQueueConflictError || serializationConflict;
    const conflictMessage = error instanceof PrintQueueConflictError
      ? error.code === "PRINT_RULE_LIMIT_REACHED"
        ? `每個攤位最多可設定 ${MAX_PRINT_RULES_PER_STALL} 筆列印規則。`
        : error.code === "CLOUDPRNT_AUTOPRINT_REQUIRED"
          ? "CloudPRNT 為自動接單模式，列印規則必須啟用自動列印。"
          : error.code === "CLOUDPRNT_MANUAL_RULES_EXIST"
            ? "切換至 CloudPRNT 前，請先將該印表機的手動列印規則改為自動列印或刪除規則。"
            : error.code === "PRINTER_HAS_IN_FLIGHT_JOBS"
              ? "印表機仍有列印中的工作，請完成或處理後再切換連線方式。"
              : error.code === "CLOUDPRNT_DEVICE_CLAIM_REQUIRED"
                ? "CloudPRNT 工作必須由印表機接單，不可由瀏覽器重複領取。"
                : error.code === "PRINT_RULE_INACTIVE"
                  ? "列印規則已停用或刪除，請重新整理列印佇列。"
          : "列印設定或工作已被其他裝置變更，請重新整理。"
      : serializationConflict
        ? "列印設定同時被其他裝置更新，請重新整理後再試。"
        : "";
    return NextResponse.json(
      {
        error: duplicate
          ? "印表機或列印規則名稱已存在。"
          : notFound
            ? "找不到指定的印表機、規則、訂單或列印工作。"
            : conflict
              ? conflictMessage
              : "目前無法更新列印工作。",
      },
      { status: duplicate || conflict ? 409 : notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}

async function findScopedPrinter(
  transaction: Transaction,
  printerId: string,
  organizationId: string,
  stallId: string,
) {
  const printer = await transaction.printer.findFirst({
    where: { id: printerId, organizationId, stallId },
  });
  if (!printer) throw new PrintQueueNotFoundError();
  return printer;
}

async function assertRuleScope(
  transaction: Transaction,
  rule: Extract<PrintQueueCommand, { operation: "CREATE_RULE" }>["rule"],
  organizationId: string,
  stallId: string,
) {
  const printer = await findScopedPrinter(transaction, rule.printerId, organizationId, stallId);
  if (printer.connectionType === "CLOUDPRNT" && !rule.autoPrint) {
    throw new PrintQueueConflictError("CLOUDPRNT_AUTOPRINT_REQUIRED");
  }
  const categoryIds = [...new Set(rule.productCategoryIds)];
  const groupIds = [...new Set(rule.productGroupIds)];
  const [categoryCount, groupCount] = await Promise.all([
    transaction.productCategory.count({ where: { organizationId, id: { in: categoryIds } } }),
    transaction.productGroup.count({ where: { organizationId, id: { in: groupIds } } }),
  ]);
  if (categoryCount !== categoryIds.length || groupCount !== groupIds.length) {
    throw new PrintQueueNotFoundError();
  }
}

function normalizePaperWidth(value: number): PrintPaperWidth {
  return value === 80 ? 80 : 58;
}

function connectionLabel(type: "WEBPRNT_BLUETOOTH" | "CLOUDPRNT" | "SYSTEM_PRINT") {
  if (type === "WEBPRNT_BLUETOOTH") return "iPad 藍牙（Star WebPRNT）";
  if (type === "CLOUDPRNT") return "Ethernet CloudPRNT";
  return "系統列印對話框";
}

function auditEntityType(operation: PrintQueueCommand["operation"]) {
  if (operation === "TEST_PRINTER") return "PRINTER";
  if (operation.includes("RULE")) return "PRINT_RULE";
  if (operation.includes("PRINTER")) return "PRINTER";
  return "PRINT_JOB";
}
