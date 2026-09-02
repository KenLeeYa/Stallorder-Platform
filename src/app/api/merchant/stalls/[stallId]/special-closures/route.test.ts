import { beforeEach, describe, expect, it, vi } from "vitest";

const stallId = "22222222-2222-4222-8222-222222222222";
const organizationId = "11111111-1111-4111-8111-111111111111";
const closureId = "33333333-3333-4333-8333-333333333333";
const otherClosureId = "44444444-4444-4444-8444-444444444444";

const mocks = vi.hoisted(() => ({
  authorize: vi.fn(),
  validateCsrf: vi.fn(),
  readJson: vi.fn(),
  transaction: vi.fn(),
  queryRaw: vi.fn(),
  findFirst: vi.fn(),
  findMany: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
  invalidatePublicMenu: vi.fn(),
  recordAuditEvent: vi.fn(),
}));

vi.mock("@/lib/authorization", () => ({
  authorizeStallManagementApiRequest: mocks.authorize,
}));
vi.mock("@/lib/csrf", () => ({ validateCsrf: mocks.validateCsrf }));
vi.mock("@/lib/http", () => ({ readJson: mocks.readJson }));
vi.mock("@/lib/public-menu", () => ({ invalidatePublicMenu: mocks.invalidatePublicMenu }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: mocks.recordAuditEvent }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "ip-hash" }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stallSpecialClosure: { findMany: mocks.findMany },
    $transaction: mocks.transaction,
  },
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.authorize.mockResolvedValue({
    ok: true,
    requestId: "request-id",
    principal: { user: { id: "55555555-5555-4555-8555-555555555555" } },
    workspace: { id: organizationId },
  });
  mocks.validateCsrf.mockReturnValue(true);
  mocks.findMany.mockResolvedValue([]);
  mocks.queryRaw.mockResolvedValue([{ id: stallId }]);
  mocks.create.mockResolvedValue({ id: closureId });
  mocks.update.mockResolvedValue({ id: closureId });
  mocks.delete.mockResolvedValue({ id: closureId });
  mocks.recordAuditEvent.mockResolvedValue(undefined);
  mocks.transaction.mockImplementation(async (operation) => operation({
    stallSpecialClosure: {
      findFirst: mocks.findFirst,
      create: mocks.create,
      update: mocks.update,
      delete: mocks.delete,
    },
    $queryRaw: mocks.queryRaw,
  }));
});

describe("special closure date conflict protection", () => {
  it("rejects a new row when any existing date overlaps", async () => {
    mocks.findFirst.mockResolvedValueOnce({ id: otherClosureId });

    const response = await patch({
      operation: "CREATE",
      startsOn: "2026-09-04",
      endsOn: "2026-09-05",
      opensAt: null,
      closesAt: null,
      title: "公休日",
      message: "",
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: "此日期已設定特殊營業時間或店休，請直接修改既有設定。",
    });
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("updates an existing row while excluding itself from overlap detection", async () => {
    mocks.findFirst
      .mockResolvedValueOnce({
        id: closureId,
        startsOn: new Date("2026-09-02T00:00:00.000Z"),
        endsOn: new Date("2026-09-02T00:00:00.000Z"),
        opensAt: null,
        closesAt: null,
        title: "公休日",
        message: "",
      })
      .mockResolvedValueOnce(null);

    const response = await patch({
      operation: "UPDATE",
      closureId,
      startsOn: "2026-09-02",
      endsOn: "2026-09-02",
      opensAt: "14:30",
      closesAt: "19:00",
      title: "特殊營業時間",
      message: "延後開店",
    });

    expect(response.status).toBe(200);
    expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: closureId },
      data: expect.objectContaining({ opensAt: "14:30", closesAt: "19:00" }),
    }));
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "STALL_SPECIAL_CLOSURE_UPDATED",
      entityId: closureId,
    }));
  });

  it("rejects an edit when its new range overlaps another row", async () => {
    mocks.findFirst
      .mockResolvedValueOnce({
        id: closureId,
        startsOn: new Date("2026-09-02T00:00:00.000Z"),
        endsOn: new Date("2026-09-02T00:00:00.000Z"),
        opensAt: null,
        closesAt: null,
        title: "公休日",
        message: "",
      })
      .mockResolvedValueOnce({ id: otherClosureId });

    const response = await patch({
      operation: "UPDATE",
      closureId,
      startsOn: "2026-09-03",
      endsOn: "2026-09-06",
      opensAt: null,
      closesAt: null,
      title: "公休日",
      message: "",
    });

    expect(response.status).toBe(409);
    expect(mocks.update).not.toHaveBeenCalled();
    expect(mocks.recordAuditEvent).not.toHaveBeenCalled();
  });

  it("deletes an existing setting, records the audit event, and refreshes public menus", async () => {
    mocks.findFirst.mockResolvedValueOnce({
      id: closureId,
      startsOn: new Date("2026-09-02T00:00:00.000Z"),
      endsOn: new Date("2026-09-02T00:00:00.000Z"),
      opensAt: "15:00",
      closesAt: "19:00",
      title: "特殊營業時間",
      message: "延後開店",
    });

    const response = await patch({ operation: "DELETE", closureId });

    expect(response.status).toBe(200);
    expect(mocks.delete).toHaveBeenCalledWith({ where: { id: closureId } });
    expect(mocks.invalidatePublicMenu).toHaveBeenCalledWith(stallId);
    expect(mocks.recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({
      action: "STALL_SPECIAL_CLOSURE_DELETED",
      entityId: closureId,
      before: expect.objectContaining({ id: closureId, opensAt: "15:00", closesAt: "19:00" }),
      after: undefined,
    }));
  });
});

async function patch(command: Record<string, unknown>) {
  mocks.readJson.mockResolvedValue({ data: command });
  const route = await import("./route");
  return route.PATCH(new Request(
    `https://example.test/api/merchant/stalls/${stallId}/special-closures`,
    { method: "PATCH", body: "{}" },
  ), { params: Promise.resolve({ stallId }) });
}
