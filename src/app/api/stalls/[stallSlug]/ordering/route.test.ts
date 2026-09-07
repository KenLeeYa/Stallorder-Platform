import { beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ authorize: vi.fn(), csrf: vi.fn(), tx: vi.fn(), stall: vi.fn(), update: vi.fn(), qrUpdate: vi.fn(), qrCreate: vi.fn(), sessions: vi.fn() }));
vi.mock("@/lib/authorization", () => ({ authorizeApiRequest: m.authorize }));
vi.mock("@/lib/csrf", () => ({ validateCsrf: m.csrf }));
vi.mock("@/lib/audit", () => ({ recordAuditEvent: vi.fn() }));
vi.mock("@/lib/security", () => ({ hashClientIp: () => "local-hash" }));
vi.mock("@/lib/public-menu", () => ({ invalidatePublicMenu: vi.fn(), invalidatePublicQrToken: vi.fn() }));
vi.mock("@/server/billing/entitlement-service", () => ({ entitlementService: { assertLimitAvailable: vi.fn() } }));
vi.mock("@/lib/prisma", () => ({ prisma: { stall: { findFirstOrThrow: m.stall }, qrCode: { findMany: vi.fn(async () => []) }, $transaction: m.tx } }));

beforeEach(() => {
  vi.clearAllMocks();
  m.authorize.mockResolvedValue({ ok: true, requestId: "test", principal: { user: { id: "owner" } }, stall: { id: "stall", organizationId: "org" } });
  m.csrf.mockReturnValue(true);
  m.stall.mockResolvedValue({ id: "stall", organizationId: "org", orderingState: "OPEN", isSoldOut: false, qrCodes: [{ id: "main-qr", tokenVersion: 2, state: "ACTIVE" }], orderingSettings: null });
  m.tx.mockImplementation((fn) => fn({
    $queryRaw: vi.fn(async () => []),
    stall: { findUniqueOrThrow: m.stall, update: m.update },
    stallCapacitySettings: { updateMany: vi.fn() },
    qrCode: { updateMany: m.qrUpdate, create: m.qrCreate },
    orderSession: { updateMany: m.sessions },
  }));
});

async function command(action: string) {
  const { PATCH } = await import("./route");
  return PATCH(new Request("http://localhost/api/stalls/demo/ordering", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }) }), { params: Promise.resolve({ stallSlug: "demo" }) });
}

it("rotating the main QR never revokes printed table or schedule QRs or their sessions", async () => {
  expect((await command("ROTATE_QR")).status).toBe(200);
  expect(m.qrUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ diningTableId: null, stallScheduleId: null, locationId: null, marketEventId: null, fulfillmentTypeContext: null }) }));
  expect(m.sessions).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ qrCode: expect.objectContaining({ diningTableId: null }) }) }));
  const queries = m.stall.mock.calls.map(([query]) => query.select?.qrCodes ?? query.include?.qrCodes).filter(Boolean);
  expect(queries.every((query) => query.where?.diningTableId === null)).toBe(true);
});

it("opening after a pause reactivates only unexpired paused QRs, without rotating them", async () => {
  expect((await command("OPEN")).status).toBe(200);
  expect(m.qrUpdate).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ state: "PAUSED", OR: [{ expiresAt: null }, { expiresAt: { gt: expect.any(Date) } }] }), data: { state: "ACTIVE" } }));
  expect(m.qrCreate).not.toHaveBeenCalled();
});

it("rejects unauthorized and CSRF requests before changing QR state", async () => {
  m.csrf.mockReturnValue(false);
  expect((await command("OPEN")).status).toBe(403);
  expect(m.tx).not.toHaveBeenCalled();
});
