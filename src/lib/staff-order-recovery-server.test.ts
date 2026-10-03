import { expect, it, vi } from "vitest";
const findFirst = vi.hoisted(() => vi.fn());
vi.mock("@/lib/prisma", () => ({ prisma: { order: { findFirst } } }));
import { findStaffOrderRecovery } from "./staff-order-create";
import { hashToken } from "./security";
import { staffOrderSelect } from "./orders";
it("binds recovery to tenant, stall, original actor hash, STAFF_POS and key without a writer", async () => {
  findFirst.mockResolvedValue(null);
  expect(await findStaffOrderRecovery({ organizationId: "org", stallId: "stall", actorProfileId: "actor", idempotencyKey: "key" })).toBeNull();
  expect(findFirst).toHaveBeenCalledWith({ where: { organizationId: "org", stallId: "stall", source: "STAFF_POS",
    deviceHash: hashToken("staff-order:actor:STAFF_POS"), idempotencyKey: "key" }, select: staffOrderSelect });
});
