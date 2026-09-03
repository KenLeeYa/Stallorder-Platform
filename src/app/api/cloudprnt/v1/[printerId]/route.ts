import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  kitchenTicketCommandBytes,
  KITCHEN_TICKET_MEDIA_TYPE,
} from "@/lib/kitchen-print-ticket";
import { readJson } from "@/lib/http";
import { prisma } from "@/lib/prisma";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  cloudPrntAuthState,
  cloudPrntJobToken,
  cloudPrntPollResponse,
  cloudPrntPollSchema,
  cloudPrntRequestedMediaType,
  cloudPrntStatusSucceeded,
  decodeCloudPrntStatus,
} from "@/server/cloudprnt/cloudprnt-protocol";
import {
  isCloudPrntDeviceId,
  verifyCloudPrntRequest,
} from "@/server/cloudprnt/cloudprnt-credentials";
import {
  printJobTicketSelect,
  resolvePrintJobTicketPayload,
} from "@/server/printing/print-job-ticket";
import { completeStreamlinedOrderAfterPrint } from "@/server/printing/streamlined-order-completion";

type RouteContext = { params: Promise<{ printerId: string }> };

const uuid = z.string().uuid();
const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export async function POST(request: Request, context: RouteContext) {
  const printer = await authenticatePrinter(request, context);
  if (printer instanceof Response) return printer;
  const limit = await checkRateLimit({
    scope: "cloudprnt-poll",
    identifier: printer.id,
    limit: 300,
    windowMs: 60_000,
  });
  if (!limit.allowed) {
    return new Response(null, {
      status: 429,
      headers: { ...responseHeaders, "retry-after": String(limit.retryAfterSeconds) },
    });
  }

  const body = await readPoll(request);
  if (!body) return new Response(null, { status: 400, headers: responseHeaders });
  await touchPrinter(printer.id);

  const status = decodeCloudPrntStatus(body.statusCode);
  const token = cloudPrntJobToken(request, body.jobToken);
  if (!cloudPrntStatusSucceeded(status)) {
    if (token && uuid.safeParse(token).success) {
      await prisma.printJob.updateMany({
        where: { id: token, printerId: printer.id, status: "PRINTING" },
        data: { lastError: `CloudPRNT: ${status}` },
      });
    }
    return Response.json(cloudPrntPollResponse(null), { headers: responseHeaders });
  }
  if (body.printingInProgress) {
    return Response.json(cloudPrntPollResponse(null), { headers: responseHeaders });
  }

  if (token && uuid.safeParse(token).success) {
    const active = await prisma.printJob.findFirst({
      where: {
        id: token,
        printerId: printer.id,
        OR: [
          { status: "PRINTING" },
          {
            status: "PENDING",
            ...automaticRuleEligibility(),
          },
        ],
      },
      select: { id: true },
    });
    return Response.json(cloudPrntPollResponse(active?.id ?? null), { headers: responseHeaders });
  }

  const job = await prisma.printJob.findFirst({
    where: {
      printerId: printer.id,
      status: "PENDING",
      AND: [
        { OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }] },
        automaticRuleEligibility(),
      ],
    },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
    select: { id: true, attemptCount: true, maxAttempts: true },
  });
  const jobId = job && job.attemptCount < job.maxAttempts ? job.id : null;
  return Response.json(cloudPrntPollResponse(jobId), { headers: responseHeaders });
}

export async function GET(request: Request, context: RouteContext) {
  const printer = await authenticatePrinter(request, context);
  if (printer instanceof Response) return printer;
  if (cloudPrntRequestedMediaType(request) !== KITCHEN_TICKET_MEDIA_TYPE) {
    return new Response(null, { status: 415, headers: responseHeaders });
  }

  const token = cloudPrntJobToken(request);
  if (!token || !uuid.safeParse(token).success) {
    return new Response(null, { status: 400, headers: responseHeaders });
  }
  const job = await prisma.printJob.findFirst({
    where: {
      id: token,
      printerId: printer.id,
      OR: [
        { status: "PRINTING" },
        {
          status: "PENDING",
          ...automaticRuleEligibility(),
        },
      ],
    },
    select: {
      status: true,
      attemptCount: true,
      maxAttempts: true,
      ...printJobTicketSelect,
    },
  });
  if (!job || (job.status === "PENDING" && job.attemptCount >= job.maxAttempts)) {
    return new Response(null, { status: 404, headers: responseHeaders });
  }

  const payload = await resolvePrintJobTicketPayload(job);
  if (job.status === "PENDING") {
    const claimed = await claimPendingCloudJob(job.id, printer.id);
    if (!claimed) return new Response(null, { status: 409, headers: responseHeaders });
  }
  await touchPrinter(printer.id);
  return new Response(kitchenTicketCommandBytes(payload), {
    status: 200,
    headers: {
      ...responseHeaders,
      "content-type": KITCHEN_TICKET_MEDIA_TYPE,
    },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const printer = await authenticatePrinter(request, context);
  if (printer instanceof Response) return printer;
  const token = cloudPrntJobToken(request);
  const code = new URL(request.url).searchParams.get("code");
  if (!token || !uuid.safeParse(token).success || !code) {
    return new Response(null, { status: 400, headers: responseHeaders });
  }

  const job = await prisma.printJob.findFirst({
    where: { id: token, printerId: printer.id },
    select: { id: true, status: true, attemptCount: true, maxAttempts: true },
  });
  if (!job) return new Response(null, { status: 404, headers: responseHeaders });

  if (cloudPrntStatusSucceeded(code)) {
    const now = new Date();
    const completed = await prisma.$transaction(async (transaction) => {
      if (job.status !== "SUCCEEDED") {
        const changed = await transaction.printJob.updateMany({
          where: { id: job.id, printerId: printer.id, status: "PRINTING" },
          data: { status: "SUCCEEDED", printedAt: now, lastError: null, nextRetryAt: null },
        });
        if (changed.count !== 1) return false;
      }
      await completeStreamlinedOrderAfterPrint(transaction, job.id, now);
      return true;
    });
    if (!completed) return new Response(null, { status: 409, headers: responseHeaders });
  } else if (job.status !== "FAILED") {
    const status = decodeCloudPrntStatus(code);
    const failed = await prisma.printJob.updateMany({
      where: { id: job.id, printerId: printer.id, status: "PRINTING" },
      data: {
        status: "FAILED",
        lastError: `CloudPRNT: ${status}`,
        nextRetryAt: job.attemptCount < job.maxAttempts ? new Date(Date.now() + 30_000) : null,
      },
    });
    if (failed.count !== 1) return new Response(null, { status: 409, headers: responseHeaders });
  }
  await touchPrinter(printer.id);
  return new Response(null, { status: 200, headers: responseHeaders });
}

async function loadLegacyPrinter(printerId: string) {
  if (!uuid.safeParse(printerId).success) return new Response(null, { status: 404, headers: responseHeaders });
  const printer = await prisma.printer.findFirst({
    where: { id: printerId, isEnabled: true, connectionType: "CLOUDPRNT" },
    select: { id: true, deviceId: true, deviceTokenHash: true },
  });
  return printer ?? new Response(null, { status: 404, headers: responseHeaders });
}

async function authenticatePrinter(request: Request, context: RouteContext) {
  const { printerId: routeIdentifier } = await context.params;
  if (isCloudPrntDeviceId(routeIdentifier)) {
    const printer = await prisma.printer.findFirst({
      where: { deviceId: routeIdentifier, isEnabled: true, connectionType: "CLOUDPRNT" },
      select: { id: true, deviceId: true, deviceTokenHash: true },
    });
    if (
      printer?.deviceId
      && printer.deviceTokenHash
      && verifyCloudPrntRequest(request, printer.deviceId, printer.deviceTokenHash)
    ) return { id: printer.id };
    return unauthorizedResponse();
  }

  const state = cloudPrntAuthState(request, routeIdentifier);
  if (state === "AUTHORIZED") {
    const printer = await loadLegacyPrinter(routeIdentifier);
    if (printer instanceof Response) return printer;
    if (printer.deviceId || printer.deviceTokenHash) return unauthorizedResponse();
    return { id: printer.id };
  }
  if (state === "NOT_CONFIGURED") {
    return new Response(null, { status: 503, headers: responseHeaders });
  }
  return unauthorizedResponse();
}

function unauthorizedResponse() {
  return new Response(null, {
    status: 401,
    headers: { ...responseHeaders, "www-authenticate": 'Basic realm="StallOrder CloudPRNT"' },
  });
}

async function claimPendingCloudJob(jobId: string, printerId: string) {
  try {
    return await prisma.$transaction(async (transaction) => {
      const printer = await transaction.printer.findFirst({
        where: { id: printerId, isEnabled: true, connectionType: "CLOUDPRNT" },
        select: { id: true },
      });
      if (!printer) return false;

      const job = await transaction.printJob.findFirst({
        where: {
          id: jobId,
          printerId,
          OR: [
            { status: "PRINTING" },
            { status: "PENDING", ...automaticRuleEligibility() },
          ],
        },
        select: { status: true, attemptCount: true, maxAttempts: true },
      });
      if (!job) return false;
      if (job.status === "PRINTING") return true;
      if (job.attemptCount >= job.maxAttempts) return false;

      const claimed = await transaction.printJob.updateMany({
        where: {
          id: jobId,
          printerId,
          status: "PENDING",
          attemptCount: { lt: job.maxAttempts },
          printer: { is: { id: printerId, isEnabled: true, connectionType: "CLOUDPRNT" } },
          ...automaticRuleEligibility(),
        },
        data: {
          status: "PRINTING",
          attemptCount: { increment: 1 },
          printingAt: new Date(),
          lastError: null,
          nextRetryAt: null,
        },
      });
      if (claimed.count === 1) return true;

      const concurrent = await transaction.printJob.findFirst({
        where: {
          id: jobId,
          printerId,
          status: "PRINTING",
          printer: { is: { id: printerId, isEnabled: true, connectionType: "CLOUDPRNT" } },
        },
        select: { id: true },
      });
      return Boolean(concurrent);
    }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034") return false;
    throw error;
  }
}

function automaticRuleEligibility(): Prisma.PrintJobWhereInput {
  return {
    OR: [
      { printRuleId: null },
      {
        printRule: {
          is: { autoPrint: true, isEnabled: true, deletedAt: null },
        },
      },
    ],
  };
}

async function readPoll(request: Request) {
  const body = await readJson(request, undefined, { maxBytes: 16_384 });
  if (body.error) return null;
  const parsed = cloudPrntPollSchema.safeParse(body.data);
  return parsed.success ? parsed.data : null;
}

async function touchPrinter(printerId: string) {
  await prisma.printer.updateMany({
    where: { id: printerId, isEnabled: true },
    data: { lastSeenAt: new Date() },
  });
}
