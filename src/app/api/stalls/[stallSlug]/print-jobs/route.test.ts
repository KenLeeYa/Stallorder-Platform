import { Prisma } from "@prisma/client";
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
  verifyManagerAuthorization: vi.fn(),
  getState: vi.fn(),
  reconcileStale: vi.fn(),
  assertFeatureEnabled: vi.fn(),
  entitlementErrorResponse: vi.fn(),
  settingsFindFirst: vi.fn(),
  transaction: vi.fn(),
  orderFindFirst: vi.fn(),
  printerFindFirst: vi.fn(),
  topLevelPrinterFindFirst: vi.fn(),
  printerCreate: vi.fn(),
  printerUpdate: vi.fn(),
  printRuleCount: vi.fn(),
  printRuleFindFirst: vi.fn(),
  printRuleCreate: vi.fn(),
  printRuleUpdate: vi.fn(),
  productCategoryCount: vi.fn(),
  productGroupCount: vi.fn(),
  printJobFindFirst: vi.fn(),
  printJobCount: vi.fn(),
  printJobCreate: vi.fn(),
  printJobUpdateMany: vi.fn(),
  claimedPrintJobFindFirst: vi.fn(),
  claimedPrintJobUpdateMany: vi.fn(),
  resolvePrintJobTicketPayload: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: mocks.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/manager-authorization", () => ({
  ManagerAuthorizationError: class ManagerAuthorizationError extends Error {},
  verifyManagerAuthorization: mocks.verifyManagerAuthorization,
}));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/http", () => ({
  readJson: vi.fn(async (request: Request) => ({ data: await request.json() })),
}));
vi.mock("@/lib/print-queue", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/print-queue")>();
  return {
    ...original,
    getPrintQueueState: mocks.getState,
    reconcileStalePrintJobs: mocks.reconcileStale,
  };
});
vi.mock("@/server/billing/entitlement-http", () => ({
  entitlementErrorResponse: mocks.entitlementErrorResponse,
}));
vi.mock("@/server/billing/entitlement-service", () => ({
  entitlementService: { assertFeatureEnabled: mocks.assertFeatureEnabled },
}));
vi.mock("@/server/printing/print-job-ticket", () => ({
  printJobTicketSelect: { id: true },
  resolvePrintJobTicketPayload: mocks.resolvePrintJobTicketPayload,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stallOrderingSettings: { findFirst: mocks.settingsFindFirst },
    printer: { findFirst: mocks.topLevelPrinterFindFirst },
    printJob: {
      findFirst: mocks.claimedPrintJobFindFirst,
      updateMany: mocks.claimedPrintJobUpdateMany,
    },
    $transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-1",
    principal: { user: { id: "66666666-6666-4666-8666-666666666666" } },
    roles: ["STAFF"],
    stall: { id: stallId, organizationId, name: "越好吃一中店", timezone: "Asia/Taipei" },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.assertFeatureEnabled.mockResolvedValue(undefined);
  mocks.entitlementErrorResponse.mockReturnValue(null);
  mocks.settingsFindFirst.mockResolvedValue({ printModuleEnabled: true });
  mocks.getState.mockResolvedValue({ printModuleEnabled: true, printers: [], jobs: [] });
  mocks.reconcileStale.mockResolvedValue({ count: 1 });
  mocks.orderFindFirst.mockResolvedValue({ id: orderId });
  mocks.printerFindFirst.mockResolvedValue({
    id: printerId,
    name: "櫃台印表機",
    isEnabled: true,
    connectionType: "WEBPRNT_BLUETOOTH",
    model: "MCP31LB",
    paperWidthMm: 58,
  });
  mocks.topLevelPrinterFindFirst.mockResolvedValue({ id: printerId });
  mocks.verifyManagerAuthorization.mockResolvedValue({ method: "SHARED_CODE" });
  mocks.printRuleCount.mockResolvedValue(0);
  mocks.printRuleFindFirst.mockResolvedValue({ id: "77777777-7777-4777-8777-777777777777" });
  mocks.printRuleCreate.mockResolvedValue({ id: "77777777-7777-4777-8777-777777777777" });
  mocks.printRuleUpdate.mockResolvedValue({ id: "77777777-7777-4777-8777-777777777777" });
  mocks.productCategoryCount.mockResolvedValue(0);
  mocks.productGroupCount.mockResolvedValue(0);
  mocks.printJobFindFirst.mockResolvedValue(null);
  mocks.printJobCount.mockResolvedValue(0);
  mocks.printJobCreate.mockResolvedValue({ id: jobId });
  mocks.printJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.claimedPrintJobFindFirst.mockResolvedValue({
    id: jobId,
    attemptCount: 1,
    maxAttempts: 3,
  });
  mocks.claimedPrintJobUpdateMany.mockResolvedValue({ count: 1 });
  mocks.resolvePrintJobTicketPayload.mockResolvedValue({
    kind: "KITCHEN_58MM_STARPRNT",
    version: "kitchen-58mm-starprnt-v1",
    mediaType: "application/vnd.star.starprnt",
    content: "測試列印\n",
    dataBase64: "G0BA",
  });
  mocks.transaction.mockImplementation(async (operation) => operation({
    order: { findFirst: mocks.orderFindFirst },
    printer: {
      findFirst: mocks.printerFindFirst,
      create: mocks.printerCreate,
      update: mocks.printerUpdate,
    },
    printRule: {
      count: mocks.printRuleCount,
      findFirst: mocks.printRuleFindFirst,
      create: mocks.printRuleCreate,
      update: mocks.printRuleUpdate,
    },
    productCategory: { count: mocks.productCategoryCount },
    productGroup: { count: mocks.productGroupCount },
    printJob: {
      count: mocks.printJobCount,
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
    ["QUEUE_RECEIPT", { operation: "QUEUE_RECEIPT", orderId }],
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

  it("queues a customer receipt through the enabled receipt rule", async () => {
    mocks.printRuleFindFirst.mockResolvedValue({
      id: "77777777-7777-4777-8777-777777777777",
      printerId,
      copies: 1,
    });

    const response = await postCommand({ operation: "QUEUE_RECEIPT", orderId });

    expect(response.status).toBe(200);
    expect(mocks.printJobCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        orderId,
        printerId,
        documentType: "CUSTOMER_RECEIPT",
      }),
    });
  });

  it("requires an enabled customer receipt rule before first receipt printing", async () => {
    mocks.printRuleFindFirst.mockResolvedValue(null);

    const response = await postCommand({ operation: "QUEUE_RECEIPT", orderId });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "請先在列印設定建立並啟用顧客收據規則。",
    });
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
    expect(mocks.reconcileStale).not.toHaveBeenCalled();
  });

  it("reconciles stale jobs only through the CSRF-protected refresh command", async () => {
    const response = await postCommand({ operation: "REFRESH" });

    expect(response.status).toBe(200);
    expect(mocks.reconcileStale).toHaveBeenCalledWith(stallId, organizationId);
    expect(mocks.transaction).not.toHaveBeenCalled();
    expect(mocks.assertFeatureEnabled).not.toHaveBeenCalled();
  });

  it("rejects refresh before reconciliation when CSRF validation fails", async () => {
    mocks.validateCsrf.mockReturnValue(false);

    const response = await postCommand({ operation: "REFRESH" });

    expect(response.status).toBe(403);
    expect(mocks.reconcileStale).not.toHaveBeenCalled();
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

  it("returns the immutable StarPRNT payload only after a print job is claimed", async () => {
    mocks.printJobFindFirst.mockResolvedValue({
      id: jobId,
      orderId,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts: 3,
    });

    const response = await postCommand({ operation: "CLAIM", jobId, printerId });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      printPayload: {
        kind: "KITCHEN_58MM_STARPRNT",
        mediaType: "application/vnd.star.starprnt",
        dataBase64: "G0BA",
      },
    });
    expect(mocks.claimedPrintJobFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        id: jobId,
        printerId,
        status: "PRINTING",
      }),
    }));
    expect(mocks.resolvePrintJobTicketPayload).toHaveBeenCalledOnce();
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  it("returns a privacy-safe device test without creating an order job", async () => {
    const response = await postCommand({ operation: "TEST_PRINTER", printerId });

    expect(response.status).toBe(200);
    expect(mocks.printJobCreate).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual(expect.objectContaining({
      entityId: printerId,
      printPayload: expect.objectContaining({ version: "printer-test-starprnt-v1" }),
    }));
  });

  it("authorizes manual cash-drawer opening without creating a print job", async () => {
    const response = await postCommand({
      operation: "AUTHORIZE_CASH_DRAWER",
      printerId,
      managerAuthorizationCode: "2468",
    });

    expect(response.status).toBe(200);
    expect(mocks.verifyManagerAuthorization).toHaveBeenCalledWith({
      stallId,
      actorProfileId: "66666666-6666-4666-8666-666666666666",
      actorRoles: ["STAFF"],
      operation: "OPEN_CASH_DRAWER",
      authorizationCode: "2468",
    });
    expect(mocks.topLevelPrinterFindFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: printerId, connectionType: "WEBPRNT_BLUETOOTH" }),
    }));
    expect(mocks.printJobCreate).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "PRINT_QUEUE_AUTHORIZE_CASH_DRAWER",
      outcome: "SUCCESS",
    }));
  });

  it("returns a retryable conflict when PostgreSQL serializes a browser claim", async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "transaction conflict",
      { code: "P2034", clientVersion: "test" },
    ));

    const response = await postCommand({ operation: "CLAIM", jobId, printerId });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "列印設定同時被其他裝置更新，請重新整理後再試。",
    });
  });

  it("creates a scoped automatic print rule after validating the destination", async () => {
    const rule = buildRule();

    const response = await postCommand({ operation: "CREATE_RULE", rule });

    expect(response.status).toBe(200);
    expect(mocks.printRuleCreate).toHaveBeenCalledWith({
      data: { organizationId, stallId, ...rule },
    });
    expect(mocks.printRuleCount).toHaveBeenCalledWith({
      where: { organizationId, stallId, deletedAt: null },
    });
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  it("rejects a fifty-first rule before database fanout can grow further", async () => {
    mocks.printRuleCount.mockResolvedValue(50);

    const response = await postCommand({ operation: "CREATE_RULE", rule: buildRule() });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "每個攤位最多可設定 50 筆列印規則。",
    });
    expect(mocks.printRuleCreate).not.toHaveBeenCalled();
  });

  it("returns a conflict when PostgreSQL serializes concurrent rule creation", async () => {
    mocks.transaction.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError(
      "transaction conflict",
      { code: "P2034", clientVersion: "test" },
    ));

    const response = await postCommand({ operation: "CREATE_RULE", rule: buildRule() });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "列印設定同時被其他裝置更新，請重新整理後再試。",
    });
  });

  it.each([
    ["UPDATE_PRINTER", {
      operation: "UPDATE_PRINTER",
      printerId,
      name: "櫃台印表機",
      isEnabled: true,
    }],
    ["UPDATE_RULE", {
      operation: "UPDATE_RULE",
      ruleId: "77777777-7777-4777-8777-777777777777",
      rule: buildRule(),
    }],
    ["DELETE_RULE", {
      operation: "DELETE_RULE",
      ruleId: "77777777-7777-4777-8777-777777777777",
    }],
  ])("uses one serializable policy boundary for %s", async (_operation, command) => {
    const response = await postCommand(command);

    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledWith(
      expect.any(Function),
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  });

  it("requires CloudPRNT rules to remain automatic", async () => {
    mocks.printerFindFirst.mockResolvedValue({
      id: printerId,
      name: "雲端印表機",
      isEnabled: true,
      connectionType: "CLOUDPRNT",
      model: "MCP31LB",
      paperWidthMm: 58,
    });

    const response = await postCommand({
      operation: "CREATE_RULE",
      rule: { ...buildRule(), autoPrint: false },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "CloudPRNT 為自動接單模式，列印規則必須啟用自動列印。",
    });
    expect(mocks.printRuleCreate).not.toHaveBeenCalled();
  });

  it("rejects switching a printer to CloudPRNT while an enabled manual rule remains", async () => {
    mocks.printRuleCount.mockResolvedValue(1);

    const response = await postCommand({
      operation: "UPDATE_PRINTER",
      printerId,
      name: "櫃台印表機",
      isEnabled: true,
      connectionType: "CLOUDPRNT",
    });

    expect(response.status).toBe(409);
    expect(mocks.printerUpdate).not.toHaveBeenCalled();
  });

  it("rejects changing transport while the printer has an in-flight job", async () => {
    mocks.printJobCount.mockResolvedValue(1);

    const response = await postCommand({
      operation: "UPDATE_PRINTER",
      printerId,
      name: "櫃台印表機",
      isEnabled: true,
      connectionType: "SYSTEM_PRINT",
    });

    expect(response.status).toBe(409);
    expect(mocks.printerUpdate).not.toHaveBeenCalled();
  });

  it("rejects disabling a printer while it has an in-flight job", async () => {
    mocks.printJobCount.mockResolvedValue(1);

    const response = await postCommand({
      operation: "UPDATE_PRINTER",
      printerId,
      name: "櫃台印表機",
      isEnabled: false,
    });

    expect(response.status).toBe(409);
    expect(mocks.printerUpdate).not.toHaveBeenCalled();
  });

  it("cancels unclaimed jobs and archives the rule without deleting provenance", async () => {
    const ruleId = "77777777-7777-4777-8777-777777777777";

    const response = await postCommand({ operation: "DELETE_RULE", ruleId });

    expect(response.status).toBe(200);
    expect(mocks.printJobUpdateMany).toHaveBeenCalledWith({
      where: {
        organizationId,
        stallId,
        printRuleId: ruleId,
        status: { in: ["PENDING", "FAILED"] },
      },
      data: { status: "CANCELLED", nextRetryAt: null },
    });
    expect(mocks.printRuleUpdate).toHaveBeenCalledWith({
      where: { id: ruleId },
      data: { isEnabled: false, deletedAt: expect.any(Date) },
    });
    expect(mocks.printRuleUpdate).toHaveBeenCalledAfter(mocks.printJobUpdateMany);
  });

  it("rejects a browser claim when its rule was archived or disabled", async () => {
    mocks.printJobFindFirst.mockResolvedValue({
      id: jobId,
      orderId,
      printerId,
      printRuleId: "77777777-7777-4777-8777-777777777777",
      status: "PENDING",
      attemptCount: 0,
      maxAttempts: 3,
    });
    mocks.printRuleFindFirst.mockResolvedValue(null);

    const response = await postCommand({ operation: "CLAIM", jobId, printerId });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "列印規則已停用或刪除，請重新整理列印佇列。",
    });
    expect(mocks.printJobUpdateMany).not.toHaveBeenCalled();
  });

  it("leaves CloudPRNT claims exclusively to the physical printer", async () => {
    mocks.printJobFindFirst.mockResolvedValue({
      id: jobId,
      orderId,
      printerId,
      printRuleId: null,
      status: "PENDING",
      attemptCount: 0,
      maxAttempts: 3,
    });
    mocks.printerFindFirst.mockResolvedValue({
      id: printerId,
      name: "雲端印表機",
      isEnabled: true,
      connectionType: "CLOUDPRNT",
      model: "MCP31LB",
      paperWidthMm: 58,
    });

    const response = await postCommand({ operation: "CLAIM", jobId, printerId });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "CloudPRNT 工作必須由印表機接單，不可由瀏覽器重複領取。",
    });
    expect(mocks.printJobUpdateMany).not.toHaveBeenCalled();
  });
});

function buildRule() {
  return {
    name: "廚房製作單",
    printerId,
    isEnabled: true,
    documentType: "KITCHEN_TICKET",
    trigger: "ORDER_CONFIRMED",
    orderSources: ["QR_MENU", "STAFF_POS"],
    orderOrigins: [],
    fulfillmentTypes: ["TAKEOUT", "DINE_IN", "DELIVERY"],
    productCategoryIds: [],
    productGroupIds: [],
    copies: 1,
    fontScale: 1,
    splitMode: "NONE",
    aggregateItems: false,
    autoPrint: true,
    showCustomerName: true,
    showCustomerPhone: true,
    showDeliveryAddress: true,
    showOrderNote: true,
    showItemNotes: true,
    showPrices: true,
    showPaymentMethod: true,
    feedLines: 2,
    sortOrder: 0,
  };
}

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
