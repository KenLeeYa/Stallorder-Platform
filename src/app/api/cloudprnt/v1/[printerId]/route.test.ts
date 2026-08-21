import { Prisma } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const printerId = "44444444-4444-4444-8444-444444444444";
const otherPrinterId = "66666666-6666-4666-8666-666666666666";
const jobId = "55555555-5555-4555-8555-555555555555";
const mediaType = "application/vnd.star.starprnt";
const originalUsername = process.env.CLOUDPRNT_POC_BASIC_USERNAME;
const originalPassword = process.env.CLOUDPRNT_POC_BASIC_PASSWORD;
const originalEnabled = process.env.CLOUDPRNT_POC_ENABLED;
const originalPrinterId = process.env.CLOUDPRNT_POC_PRINTER_ID;

const mocks = vi.hoisted(() => ({
  printerFindFirst: vi.fn(),
  printerUpdateMany: vi.fn(),
  printJobFindFirst: vi.fn(),
  printJobFindUnique: vi.fn(),
  printJobUpdate: vi.fn(),
  printJobUpdateMany: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    printer: {
      findFirst: mocks.printerFindFirst,
      updateMany: mocks.printerUpdateMany,
    },
    printJob: {
      findFirst: mocks.printJobFindFirst,
      findUnique: mocks.printJobFindUnique,
      update: mocks.printJobUpdate,
      updateMany: mocks.printJobUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDPRNT_POC_ENABLED = "true";
  process.env.CLOUDPRNT_POC_PRINTER_ID = printerId;
  process.env.CLOUDPRNT_POC_BASIC_USERNAME = "mcp31lb";
  process.env.CLOUDPRNT_POC_BASIC_PASSWORD = "a-strong-test-password";
  mocks.printerFindFirst.mockResolvedValue({ id: printerId });
  mocks.printerUpdateMany.mockResolvedValue({ count: 1 });
  mocks.printJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.printJobUpdate.mockResolvedValue({ id: jobId });
  mocks.transaction.mockImplementation(async (operation) => operation({
    printer: { findFirst: mocks.printerFindFirst },
    printJob: {
      findFirst: mocks.printJobFindFirst,
      updateMany: mocks.printJobUpdateMany,
    },
  }));
});

afterAll(() => {
  if (originalEnabled === undefined) delete process.env.CLOUDPRNT_POC_ENABLED;
  else process.env.CLOUDPRNT_POC_ENABLED = originalEnabled;
  if (originalPrinterId === undefined) delete process.env.CLOUDPRNT_POC_PRINTER_ID;
  else process.env.CLOUDPRNT_POC_PRINTER_ID = originalPrinterId;
  if (originalUsername === undefined) delete process.env.CLOUDPRNT_POC_BASIC_USERNAME;
  else process.env.CLOUDPRNT_POC_BASIC_USERNAME = originalUsername;
  if (originalPassword === undefined) delete process.env.CLOUDPRNT_POC_BASIC_PASSWORD;
  else process.env.CLOUDPRNT_POC_BASIC_PASSWORD = originalPassword;
});

describe("MCP31LB CloudPRNT HTTP PoC", () => {
  it("rejects unauthenticated printer traffic before reading queue state", async () => {
    const route = await import("./route");
    const response = await route.POST(
      new Request(endpoint(), { method: "POST", body: JSON.stringify({ statusCode: "200%20OK" }) }),
      context(),
    );

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toContain("Basic");
    expect(mocks.printerFindFirst).not.toHaveBeenCalled();
  });

  it("rejects the valid PoC credential for every operation outside the configured printer allowlist", async () => {
    const route = await import("./route");
    const postResponse = await route.POST(
      printerRequest(endpoint(otherPrinterId), {
        method: "POST",
        body: JSON.stringify({ statusCode: "200%20OK" }),
      }),
      context(otherPrinterId),
    );
    const getResponse = await route.GET(
      printerRequest(`${endpoint(otherPrinterId)}?type=${encodeURIComponent(mediaType)}&token=${jobId}`),
      context(otherPrinterId),
    );
    const deleteResponse = await route.DELETE(
      printerRequest(`${endpoint(otherPrinterId)}?token=${jobId}&code=200%20OK`, { method: "DELETE" }),
      context(otherPrinterId),
    );

    expect([postResponse.status, getResponse.status, deleteResponse.status]).toEqual([401, 401, 401]);
    expect(mocks.printerFindFirst).not.toHaveBeenCalled();
    expect(mocks.printJobFindFirst).not.toHaveBeenCalled();
    expect(mocks.printJobUpdateMany).not.toHaveBeenCalled();
  });

  it("keeps the endpoint unavailable until the PoC is explicitly enabled", async () => {
    process.env.CLOUDPRNT_POC_ENABLED = "false";
    const route = await import("./route");
    const response = await route.POST(
      printerRequest(endpoint(), { method: "POST", body: JSON.stringify({ statusCode: "200%20OK" }) }),
      context(),
    );

    expect(response.status).toBe(503);
    expect(mocks.printerFindFirst).not.toHaveBeenCalled();
  });

  it("rejects every CloudPRNT method after the logical printer switches transport", async () => {
    mocks.printerFindFirst.mockResolvedValue(null);
    const route = await import("./route");

    const postResponse = await route.POST(
      printerRequest(endpoint(), { method: "POST", body: JSON.stringify({ statusCode: "200%20OK" }) }),
      context(),
    );
    const getResponse = await route.GET(
      printerRequest(`${endpoint()}?type=${encodeURIComponent(mediaType)}&token=${jobId}`),
      context(),
    );
    const deleteResponse = await route.DELETE(
      printerRequest(`${endpoint()}?token=${jobId}&code=200%20OK`, { method: "DELETE" }),
      context(),
    );

    expect([postResponse.status, getResponse.status, deleteResponse.status]).toEqual([404, 404, 404]);
    expect(mocks.printerFindFirst).toHaveBeenCalledTimes(3);
    expect(mocks.printerFindFirst).toHaveBeenCalledWith({
      where: { id: printerId, isEnabled: true, connectionType: "CLOUDPRNT" },
      select: { id: true },
    });
    expect(mocks.printJobFindFirst).not.toHaveBeenCalled();
  });

  it("announces the oldest assigned pending job with a stable job token", async () => {
    mocks.printJobFindFirst.mockResolvedValue({ id: jobId, attemptCount: 0, maxAttempts: 3 });
    const route = await import("./route");
    const response = await route.POST(printerRequest(endpoint(), {
      method: "POST",
      body: JSON.stringify({
        statusCode: "200%20OK",
        printerMAC: "00:11:62:1d:e8:30",
        printingInProgress: false,
      }),
    }), context());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      jobReady: true,
      mediaTypes: [mediaType],
      jobToken: jobId,
      deleteMethod: "DELETE",
    });
    expect(mocks.printJobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        printerId,
        status: "PENDING",
        AND: expect.arrayContaining([
          {
            OR: [
              { printRuleId: null },
              { printRule: { is: { autoPrint: true, isEnabled: true, deletedAt: null } } },
            ],
          },
        ]),
      }),
    }));
    expect(mocks.printJobUpdateMany).not.toHaveBeenCalled();
  });

  it("persists one compact payload, claims once, and returns identical bytes for a repeated GET", async () => {
    let persistedPayload: unknown = null;
    const pendingJob = buildJob(null, "PENDING");
    mocks.printJobFindFirst.mockResolvedValue(pendingJob);
    mocks.printJobUpdateMany.mockImplementation(async ({ data }) => {
      if (data.payload) persistedPayload = data.payload;
      return { count: 1 };
    });
    const route = await import("./route");
    const first = await route.GET(
      printerRequest(`${endpoint()}?type=${encodeURIComponent(mediaType)}&token=${jobId}`),
      context(),
    );
    const firstBody = Buffer.from(await first.arrayBuffer());

    expect(first.status).toBe(200);
    expect(first.headers.get("x-star-cut")).toBeNull();
    expect(first.headers.get("content-type")).toBe(mediaType);
    expect(firstBody.includes(Buffer.from("越好吃一中店｜廚房製作單", "utf8"))).toBe(true);
    expect(firstBody.includes(Buffer.from("外帶自取 #A023 ★預約", "utf8"))).toBe(true);
    expect(firstBody.subarray(-3)).toEqual(Buffer.from([0x1b, 0x64, 0x02]));
    expect(mocks.printJobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: jobId,
        printerId,
        OR: expect.arrayContaining([
          {
            status: "PENDING",
            OR: [
              { printRuleId: null },
              { printRule: { is: { autoPrint: true, isEnabled: true, deletedAt: null } } },
            ],
          },
        ]),
      }),
    }));
    expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: jobId,
        status: "PENDING",
        printer: { is: { id: printerId, isEnabled: true, connectionType: "CLOUDPRNT" } },
        OR: [
          { printRuleId: null },
          { printRule: { is: { autoPrint: true, isEnabled: true, deletedAt: null } } },
        ],
      }),
      data: expect.objectContaining({ status: "PRINTING", attemptCount: { increment: 1 } }),
    }));
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    mocks.printJobFindFirst.mockResolvedValue(buildJob(persistedPayload, "PRINTING"));
    mocks.printJobUpdateMany.mockClear();
    const repeated = await route.GET(
      printerRequest(`${endpoint()}?type=${encodeURIComponent(mediaType)}&token=${jobId}`),
      context(),
    );

    expect(Buffer.from(await repeated.arrayBuffer())).toEqual(firstBody);
    expect(mocks.printJobUpdateMany).not.toHaveBeenCalled();
  });

  it("returns one immutable payload and one claim when two GET requests race", async () => {
    let persistedPayload: unknown = null;
    let payloadWon = false;
    let claimWon = false;
    mocks.printJobFindFirst.mockResolvedValue(buildJob(null, "PENDING"));
    mocks.printJobUpdateMany.mockImplementation(async ({ data }) => {
      if (data.payload) {
        if (payloadWon) return { count: 0 };
        payloadWon = true;
        persistedPayload = data.payload;
        return { count: 1 };
      }
      if (data.status === "PRINTING") {
        if (claimWon) return { count: 0 };
        claimWon = true;
        return { count: 1 };
      }
      return { count: 1 };
    });
    mocks.printJobFindUnique.mockImplementation(async ({ select }) => (
      select.payload ? { payload: persistedPayload } : { status: "PRINTING" }
    ));
    const route = await import("./route");

    const [left, right] = await Promise.all([
      route.GET(printerRequest(`${endpoint()}?type=${encodeURIComponent(mediaType)}&token=${jobId}`), context()),
      route.GET(printerRequest(`${endpoint()}?type=${encodeURIComponent(mediaType)}&token=${jobId}`), context()),
    ]);

    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(Buffer.from(await left.arrayBuffer())).toEqual(Buffer.from(await right.arrayBuffer()));
    expect(payloadWon).toBe(true);
    expect(claimWon).toBe(true);
  });

  it("returns a retryable conflict when PostgreSQL serializes a Cloud claim", async () => {
    mocks.printJobFindFirst.mockResolvedValue(buildJob(null, "PENDING"));
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "transaction conflict",
      { code: "P2034", clientVersion: "test" },
    ));
    const route = await import("./route");

    const response = await route.GET(
      printerRequest(`${endpoint()}?type=${encodeURIComponent(mediaType)}&token=${jobId}`),
      context(),
    );

    expect(response.status).toBe(409);
  });

  it("marks a job successful only after the printer DELETE confirmation", async () => {
    mocks.printJobFindFirst.mockResolvedValue({
      id: jobId,
      status: "PRINTING",
      attemptCount: 1,
      maxAttempts: 3,
    });
    const route = await import("./route");
    const response = await route.DELETE(
      printerRequest(`${endpoint()}?token=${jobId}&code=200%20OK`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: jobId, printerId, status: "PRINTING" },
      data: expect.objectContaining({ status: "SUCCEEDED" }),
    }));
  });

  it("records printer-declared media failures for an explicit retry", async () => {
    mocks.printJobFindFirst.mockResolvedValue({
      id: jobId,
      status: "PRINTING",
      attemptCount: 1,
      maxAttempts: 3,
    });
    const route = await import("./route");
    const response = await route.DELETE(
      printerRequest(`${endpoint()}?token=${jobId}&code=510%20Media%20Type%20Error`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({
        status: "FAILED",
        lastError: "CloudPRNT: 510 Media Type Error",
      }),
    }));
  });

  it("accepts a retried success DELETE without mutating the completed job", async () => {
    mocks.printJobFindFirst.mockResolvedValue({
      id: jobId,
      status: "SUCCEEDED",
      attemptCount: 1,
      maxAttempts: 3,
    });
    const route = await import("./route");
    const response = await route.DELETE(
      printerRequest(`${endpoint()}?token=${jobId}&code=200%20OK&retry=1`, { method: "DELETE" }),
      context(),
    );

    expect(response.status).toBe(200);
    expect(mocks.printJobUpdateMany).not.toHaveBeenCalled();
  });
});

function buildJob(payload: unknown, status: "PENDING" | "PRINTING") {
  return {
    id: jobId,
    status,
    attemptCount: status === "PENDING" ? 0 : 1,
    maxAttempts: 3,
    reprintOfId: null,
    payload,
    stall: { name: "越好吃一中店", timezone: "Asia/Taipei" },
    order: {
      orderNo: "A023",
      fulfillmentType: "TAKEOUT",
      tableLabel: null,
      note: "河粉先做，飲料稍後",
      createdAt: new Date("2026-08-21T10:42:00.000Z"),
      scheduledPickupAt: new Date("2026-08-21T11:00:00.000Z"),
      requestedFulfillmentAt: null,
      committedFulfillmentAt: null,
      items: [{
        name: "牛肉湯河粉",
        quantity: 2,
        note: "不要香菜",
        noteOptions: [{ optionName: "加麵" }, { optionName: "肉量加倍" }],
      }],
    },
  };
}

function endpoint(id = printerId) {
  return `https://physical-preview.example.test/api/cloudprnt/v1/${id}`;
}

function context(id = printerId) {
  return { params: Promise.resolve({ printerId: id }) };
}

function printerRequest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(
    "authorization",
    `Basic ${Buffer.from("mcp31lb:a-strong-test-password", "utf8").toString("base64")}`,
  );
  return new Request(url, { ...init, headers });
}
