import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const printerId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";
const originalUsername = process.env.CLOUDPRNT_POC_BASIC_USERNAME;
const originalPassword = process.env.CLOUDPRNT_POC_BASIC_PASSWORD;

const mocks = vi.hoisted(() => ({
  printerFindFirst: vi.fn(),
  printerUpdateMany: vi.fn(),
  printJobFindFirst: vi.fn(),
  printJobFindUnique: vi.fn(),
  printJobUpdate: vi.fn(),
  printJobUpdateMany: vi.fn(),
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
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLOUDPRNT_POC_BASIC_USERNAME = "mcp31lb";
  process.env.CLOUDPRNT_POC_BASIC_PASSWORD = "a-strong-test-password";
  mocks.printerFindFirst.mockResolvedValue({ id: printerId });
  mocks.printerUpdateMany.mockResolvedValue({ count: 1 });
  mocks.printJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.printJobUpdate.mockResolvedValue({ id: jobId });
});

afterAll(() => {
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
      mediaTypes: ["text/plain"],
      jobToken: jobId,
      deleteMethod: "DELETE",
    });
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
    const first = await route.GET(printerRequest(`${endpoint()}?type=text%2Fplain&token=${jobId}`), context());
    const firstBody = await first.text();

    expect(first.status).toBe(200);
    expect(first.headers.get("x-star-cut")).toBe("partial; feed=true");
    expect(first.headers.get("content-type")).toContain("text/plain");
    expect(firstBody).toContain("越好吃一中店｜廚房製作單");
    expect(firstBody).toContain("外帶自取 #A023 ★預約");
    expect(firstBody).not.toMatch(/\[[A-D]\d\]/);
    expect(firstBody).not.toContain("\n\n");
    expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: jobId, status: "PENDING" }),
      data: expect.objectContaining({ status: "PRINTING", attemptCount: { increment: 1 } }),
    }));

    mocks.printJobFindFirst.mockResolvedValue(buildJob(persistedPayload, "PRINTING"));
    mocks.printJobUpdateMany.mockClear();
    const repeated = await route.GET(printerRequest(`${endpoint()}?type=text%2Fplain&token=${jobId}`), context());

    expect(await repeated.text()).toBe(firstBody);
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
      route.GET(printerRequest(`${endpoint()}?type=text%2Fplain&token=${jobId}`), context()),
      route.GET(printerRequest(`${endpoint()}?type=text%2Fplain&token=${jobId}`), context()),
    ]);

    expect(left.status).toBe(200);
    expect(right.status).toBe(200);
    expect(await left.text()).toBe(await right.text());
    expect(payloadWon).toBe(true);
    expect(claimWon).toBe(true);
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

function endpoint() {
  return `https://staging.example.test/api/cloudprnt/v1/${printerId}`;
}

function context() {
  return { params: Promise.resolve({ printerId }) };
}

function printerRequest(url: string, init: RequestInit = {}) {
  const headers = new Headers(init.headers);
  headers.set(
    "authorization",
    `Basic ${Buffer.from("mcp31lb:a-strong-test-password", "utf8").toString("base64")}`,
  );
  return new Request(url, { ...init, headers });
}
