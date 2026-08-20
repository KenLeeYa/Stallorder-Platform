import { beforeEach, describe, expect, it, vi } from "vitest";

const organizationId = "11111111-1111-4111-8111-111111111111";
const stallId = "22222222-2222-4222-8222-222222222222";
const orderId = "33333333-3333-4333-8333-333333333333";
const printerId = "44444444-4444-4444-8444-444444444444";
const jobId = "55555555-5555-4555-8555-555555555555";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  recordAuditEvent: vi.fn(),
  getState: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  entitlementErrorResponse: vi.fn(),
  settingsFindFirst: vi.fn(),
  transaction: vi.fn(),
  orderFindFirst: vi.fn(),
  printerFindFirst: vi.fn(),
  printJobFindFirst: vi.fn(),
  printJobCreate: vi.fn(),
  printJobUpdateMany: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/print-queue", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/print-queue")>();
  return { ...original, getPrintQueueState: mocks.getState };
});
vi.mock("@/server/billing/entitlement-http", () => ({
  entitlementErrorResponse: mocks.entitlementErrorResponse,
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: { assertFeatureEnabled: mocks.assertFeatureEnabled },
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stallOrderingSettings: { findFirst: mocks.settingsFindFirst },
    $transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "66666666-6666-4666-8666-666666666666" } },
    stall: { id: stallId, organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.assertFeatureEnabled.mockResolvedValue(undefined);
  mocks.entitlementErrorResponse.mockReturnValue(null);
  mocks.settingsFindFirst.mockResolvedValue({ printModuleEnabled: true });
  mocks.getState.mockResolvedValue({ printModuleEnabled: true, printers: [], jobs: [] });
  mocks.orderFindFirst.mockResolvedValue({ id: orderId });
  mocks.printerFindFirst.mockResolvedValue({ id: printerId });
  mocks.printJobFindFirst.mockResolvedValue(null);
  mocks.printJobCreate.mockResolvedValue({ id: jobId });
  mocks.printJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.transaction.mockImplementation(async (operation) => operation({
    order: { findFirst: mocks.orderFindFirst },
    printer: { findFirst: mocks.printerFindFirst },
    printJob: {
      findFirst: mocks.printJobFindFirst,
      create: mocks.printJobCreate,
      updateMany: mocks.printJobUpdateMany,
    },
  }));
});

describe("print queue capability enforcement", () => {
  it.each([
    ["REGISTER_PRINTER", { operation: "REGISTER_PRINTER", name: "Counter printer" }],
    ["QUEUE", { operation: "QUEUE", orderId }],
    ["CLAIM", { operation: "CLAIM", jobId, printerId }],
    ["REPRINT", { operation: "REPRINT", jobId }],
  ])("rejects %s when the stall has not enabled its print module", async (_operation, command) => {
    mocks.settingsFindFirst.mockResolvedValue({ printModuleEnabled: false });

    const response = await postCommand(command);

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "列印模組目前未啟用。",
      code: "PRINT_MODULE_DISABLED",
    });
    expect(mocks.assertFeatureEnabled).toHaveBeenCalledWith(organizationId, "PRINTER_INTEGRATION");
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("returns the standard entitlement denial before disclosing module state", async () => {
    const entitlementError = new Error("FEATURE_NOT_INCLUDED");
    mocks.assertFeatureEnabled.mockRejectedValue(entitlementError);
    mocks.entitlementErrorResponse.mockReturnValue(Response.json(
      { error: "方案未包含此功能。", code: "FEATURE_NOT_INCLUDED" },
      { status: 403 },
    ));

    const response = await postCommand({ operation: "QUEUE", orderId });

    expect(response.status).toBe(403);
    expect(mocks.entitlementErrorResponse).toHaveBeenCalledWith(entitlementError, "request-1");
    expect(mocks.settingsFindFirst).not.toHaveBeenCalled();
    expect(mocks.transaction).not.toHaveBeenCalled();
  });

  it("queues a new job only after both entitlement and module checks pass", async () => {
    const response = await postCommand({ operation: "QUEUE", orderId });

    expect(response.status).toBe(200);
    expect(mocks.settingsFindFirst).toHaveBeenCalledWith({
      where: { organizationId, stallId },
      select: { printModuleEnabled: true },
    });
    expect(mocks.printJobCreate).toHaveBeenCalled();
  });

  it("keeps history reads available without an entitlement or module mutation gate", async () => {
    const route = await import("./route");
    const response = await route.GET(
      new Request("https://example.test/api/stalls/demo/print-jobs"),
      { params: Promise.resolve({ stallSlug: "demo" }) },
    );

    expect(response.status).toBe(200);
    expect(mocks.assertFeatureEnabled).not.toHaveBeenCalled();
    expect(mocks.settingsFindFirst).not.toHaveBeenCalled();
  });

  it("allows an in-flight job to report success after entitlement or module changes", async () => {
    mocks.printJobFindFirst.mockResolvedValue({
      id: jobId,
      orderId,
      status: "PRINTING",
      attemptCount: 1,
      maxAttempts: 3,
    });

    const response = await postCommand({ operation: "SUCCESS", jobId });

    expect(response.status).toBe(200);
    expect(mocks.assertFeatureEnabled).not.toHaveBeenCalled();
    expect(mocks.settingsFindFirst).not.toHaveBeenCalled();
    expect(mocks.printJobUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: jobId, status: "PRINTING" },
    }));
  });
});

async function postCommand(command: unknown) {
  const route = await import("./route");
  return route.POST(
    new Request("https://example.test/api/stalls/demo/print-jobs", {
      method: "POST",
      body: JSON.stringify(command),
    }),
    { params: Promise.resolve({ stallSlug: "demo" }) },
  );
}
