import { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { recordAuditEvent } from "@/lib/audit";
import { authorizeApiRequest } from "@/lib/authorization";
import { validateCsrf } from "@/lib/csrf";
import { readJson } from "@/lib/http";
import { getPrintQueueState, printQueueCommandSchema } from "@/lib/print-queue";
import { prisma } from "@/lib/prisma";
import { hashClientIp } from "@/lib/security";

type RouteContext = { params: Promise<{ stallSlug: string }> };
class PrintQueueNotFoundError extends Error {}
class PrintQueueConflictError extends Error {}

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
    const entityId = await prisma.$transaction(async (transaction) => {
      if (command.operation === "REGISTER_PRINTER") {
        const printer = await transaction.printer.create({
          data: { organizationId, stallId, name: command.name, lastSeenAt: new Date() },
        });
        return printer.id;
      }
      if (command.operation === "UPDATE_PRINTER") {
        const printer = await transaction.printer.findFirst({ where: { id: command.printerId, organizationId, stallId } });
        if (!printer) throw new PrintQueueNotFoundError();
        await transaction.printer.update({ where: { id: printer.id }, data: { name: command.name, isEnabled: command.isEnabled } });
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
      if (command.operation === "QUEUE") {
        const order = await transaction.order.findFirst({ where: { id: command.orderId, organizationId, stallId } });
        if (!order) throw new PrintQueueNotFoundError();
        const existing = await transaction.printJob.findFirst({ where: { orderId: order.id, reprintOfId: null } });
        if (existing) return existing.id;
        const printer = await transaction.printer.findFirst({
          where: { organizationId, stallId, isEnabled: true },
          orderBy: [{ lastSeenAt: "desc" }, { createdAt: "asc" }],
        });
        const job = await transaction.printJob.create({
          data: { organizationId, stallId, orderId: order.id, printerId: printer?.id, requestedById: authorization.principal.user.id },
        });
        return job.id;
      }

      const job = await transaction.printJob.findFirst({
        where: { id: command.jobId, organizationId, stallId },
      });
      if (!job) throw new PrintQueueNotFoundError();

      if (command.operation === "CLAIM") {
        const printer = await transaction.printer.findFirst({
          where: { id: command.printerId, organizationId, stallId, isEnabled: true },
        });
        if (!printer) throw new PrintQueueNotFoundError();
        const changed = await transaction.printJob.updateMany({
          where: { id: job.id, status: { in: ["PENDING", "FAILED"] }, attemptCount: { lt: job.maxAttempts } },
          data: { status: "PRINTING", printerId: printer.id, attemptCount: { increment: 1 }, printingAt: new Date(), lastError: null, nextRetryAt: null },
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
        const printer = await transaction.printer.findFirst({
          where: { organizationId, stallId, isEnabled: true },
          orderBy: [{ lastSeenAt: "desc" }, { createdAt: "asc" }],
        });
        const reprint = await transaction.printJob.create({
          data: {
            organizationId,
            stallId,
            orderId: job.orderId,
            printerId: printer?.id,
            requestedById: authorization.principal.user.id,
            reprintOfId: job.id,
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
    });

    if (command.operation !== "HEARTBEAT") {
      await recordAuditEvent({
        organizationId,
        stallId,
        actorProfileId: authorization.principal.user.id,
        action: `PRINT_QUEUE_${command.operation}`,
        entityType: command.operation.includes("PRINTER") ? "PRINTER" : "PRINT_JOB",
        entityId,
        outcome: "SUCCESS",
        requestId: authorization.requestId,
        ipHash: hashClientIp(request),
      });
    }
    return NextResponse.json(
      { state: await getPrintQueueState(stallId, organizationId) },
      { headers: { "cache-control": "no-store", "x-request-id": authorization.requestId } },
    );
  } catch (error) {
    const duplicate = error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    const notFound = error instanceof PrintQueueNotFoundError;
    const conflict = error instanceof PrintQueueConflictError;
    return NextResponse.json(
      { error: duplicate ? "印表機名稱已存在。" : notFound ? "找不到指定的印表機、訂單或列印工作。" : conflict ? "列印工作已被其他裝置處理，請重新整理。" : "目前無法更新列印工作。" },
      { status: duplicate || conflict ? 409 : notFound ? 404 : 500, headers: { "x-request-id": authorization.requestId } },
    );
  }
}
