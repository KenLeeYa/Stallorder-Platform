import { Prisma } from "@prisma/client";
import { z } from "zod";
import {
  createKitchenTicketPayload,
  kitchenTicketPayloadSchema,
  KITCHEN_TICKET_TEMPLATE_VERSION,
} from "@/lib/kitchen-print-ticket";
import { prisma } from "@/lib/prisma";
import {
  cloudPrntAuthState,
  cloudPrntJobToken,
  cloudPrntPollResponse,
  cloudPrntPollSchema,
  cloudPrntRequestedMediaType,
  cloudPrntStatusSucceeded,
  decodeCloudPrntStatus,
} from "@/server/cloudprnt/cloudprnt-protocol";

type RouteContext = { params: Promise<{ printerId: string }> };

const uuid = z.string().uuid();
const responseHeaders = {
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export async function POST(request: Request, context: RouteContext) {
  const authentication = await authenticate(request, context);
  if (authentication instanceof Response) return authentication;
  const printer = await loadPrinter(authentication.printerId);
  if (printer instanceof Response) return printer;

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
      where: { id: token, printerId: printer.id, status: { in: ["PENDING", "PRINTING"] } },
      select: { id: true },
    });
    return Response.json(cloudPrntPollResponse(active?.id ?? null), { headers: responseHeaders });
  }

  const job = await prisma.printJob.findFirst({
    where: {
      printerId: printer.id,
      status: "PENDING",
      OR: [{ nextRetryAt: null }, { nextRetryAt: { lte: new Date() } }],
    },
    orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
    select: { id: true, attemptCount: true, maxAttempts: true },
  });
  const jobId = job && job.attemptCount < job.maxAttempts ? job.id : null;
  return Response.json(cloudPrntPollResponse(jobId), { headers: responseHeaders });
}

export async function GET(request: Request, context: RouteContext) {
  const authentication = await authenticate(request, context);
  if (authentication instanceof Response) return authentication;
  const printer = await loadPrinter(authentication.printerId);
  if (printer instanceof Response) return printer;
  if (cloudPrntRequestedMediaType(request) !== "text/plain") {
    return new Response(null, { status: 415, headers: responseHeaders });
  }

  const token = cloudPrntJobToken(request);
  if (!token || !uuid.safeParse(token).success) {
    return new Response(null, { status: 400, headers: responseHeaders });
  }
  const job = await prisma.printJob.findFirst({
    where: { id: token, printerId: printer.id, status: { in: ["PENDING", "PRINTING"] } },
    select: {
      id: true,
      status: true,
      attemptCount: true,
      maxAttempts: true,
      reprintOfId: true,
      payload: true,
      stall: { select: { name: true, timezone: true } },
      order: {
        select: {
          orderNo: true,
          fulfillmentType: true,
          tableLabel: true,
          note: true,
          createdAt: true,
          scheduledPickupAt: true,
          requestedFulfillmentAt: true,
          committedFulfillmentAt: true,
          items: {
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
              name: true,
              quantity: true,
              note: true,
              noteOptions: { select: { optionName: true } },
            },
          },
        },
      },
    },
  });
  if (!job || (job.status === "PENDING" && job.attemptCount >= job.maxAttempts)) {
    return new Response(null, { status: 404, headers: responseHeaders });
  }

  const payload = await resolvePayload(job);
  if (job.status === "PENDING") {
    const claimed = await prisma.printJob.updateMany({
      where: { id: job.id, printerId: printer.id, status: "PENDING", attemptCount: { lt: job.maxAttempts } },
      data: {
        status: "PRINTING",
        attemptCount: { increment: 1 },
        printingAt: new Date(),
        lastError: null,
        nextRetryAt: null,
      },
    });
    if (claimed.count !== 1) {
      const concurrent = await prisma.printJob.findUnique({ where: { id: job.id }, select: { status: true } });
      if (concurrent?.status !== "PRINTING") return new Response(null, { status: 409, headers: responseHeaders });
    }
  }
  await touchPrinter(printer.id);
  return new Response(payload.content, {
    status: 200,
    headers: {
      ...responseHeaders,
      "content-type": "text/plain; charset=utf-8",
      "x-star-cut": "partial; feed=true",
    },
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  const authentication = await authenticate(request, context);
  if (authentication instanceof Response) return authentication;
  const printer = await loadPrinter(authentication.printerId);
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
    if (job.status !== "SUCCEEDED") {
      const completed = await prisma.printJob.updateMany({
        where: { id: job.id, printerId: printer.id, status: "PRINTING" },
        data: { status: "SUCCEEDED", printedAt: new Date(), lastError: null, nextRetryAt: null },
      });
      if (completed.count !== 1) return new Response(null, { status: 409, headers: responseHeaders });
    }
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

async function resolvePayload(job: {
  id: string;
  payload: Prisma.JsonValue | null;
  reprintOfId: string | null;
  stall: { name: string; timezone: string };
  order: {
    orderNo: string;
    fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
    tableLabel: string | null;
    note: string | null;
    createdAt: Date;
    scheduledPickupAt: Date | null;
    requestedFulfillmentAt: Date | null;
    committedFulfillmentAt: Date | null;
    items: Array<{
      name: string;
      quantity: number;
      note: string | null;
      noteOptions: Array<{ optionName: string }>;
    }>;
  };
}) {
  const stored = kitchenTicketPayloadSchema.safeParse(job.payload);
  if (stored.success) return stored.data;
  const payload = createKitchenTicketPayload({
    stallName: job.stall.name,
    timeZone: job.stall.timezone,
    order: job.order,
    printedAt: new Date(),
    isReprint: Boolean(job.reprintOfId),
  });
  if (job.payload === null) {
    const persisted = await prisma.printJob.updateMany({
      where: { id: job.id, payload: { equals: Prisma.DbNull } },
      data: {
        payload: payload as Prisma.InputJsonValue,
        templateVersion: KITCHEN_TICKET_TEMPLATE_VERSION,
      },
    });
    if (persisted.count === 1) return payload;
    const concurrent = await prisma.printJob.findUnique({
      where: { id: job.id },
      select: { payload: true },
    });
    const concurrentPayload = kitchenTicketPayloadSchema.safeParse(concurrent?.payload);
    if (concurrentPayload.success) return concurrentPayload.data;
    throw new Error("CloudPRNT payload persistence conflict");
  }
  await prisma.printJob.update({
    where: { id: job.id },
    data: { payload: payload as Prisma.InputJsonValue, templateVersion: KITCHEN_TICKET_TEMPLATE_VERSION },
  });
  return payload;
}

async function loadPrinter(printerId: string) {
  if (!uuid.safeParse(printerId).success) return new Response(null, { status: 404, headers: responseHeaders });
  const printer = await prisma.printer.findFirst({
    where: { id: printerId, isEnabled: true },
    select: { id: true },
  });
  return printer ?? new Response(null, { status: 404, headers: responseHeaders });
}

async function authenticate(request: Request, context: RouteContext) {
  const { printerId } = await context.params;
  const state = cloudPrntAuthState(request, printerId);
  if (state === "AUTHORIZED") return { printerId };
  if (state === "NOT_CONFIGURED") {
    return new Response(null, { status: 503, headers: responseHeaders });
  }
  return new Response(null, {
    status: 401,
    headers: { ...responseHeaders, "www-authenticate": 'Basic realm="StallOrder CloudPRNT"' },
  });
}

async function readPoll(request: Request) {
  try {
    const parsed = cloudPrntPollSchema.safeParse(await request.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function touchPrinter(printerId: string) {
  await prisma.printer.updateMany({
    where: { id: printerId, isEnabled: true },
    data: { lastSeenAt: new Date() },
  });
}
