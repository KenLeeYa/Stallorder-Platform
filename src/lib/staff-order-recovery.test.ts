import { describe, expect, it } from "vitest";
import { readStaffOrderRecovery, claimStaffOrderRecovery, clearStaffOrderRecovery, staffOrderRecoveryKey, type StaffOrderRecovery } from "./staff-order-recovery";
const marker: StaffOrderRecovery = { version: 1, organizationId: "org", stallId: "stall", actorProfileId: "actor", idempotencyKey: "key", paymentTiming: "PAY_LATER", cash: false, draftId: "draft" };
function storage() { const items = new Map<string, string>(); return { getItem: (key: string) => items.get(key) ?? null, setItem: (key: string, value: string) => { items.set(key, value); }, removeItem: (key: string) => { items.delete(key); } }; }
describe("POS recovery identity", () => {
  it("survives remount without customer fields and refuses replacement, including another actor", () => {
    const store = storage();
    expect(claimStaffOrderRecovery(store, marker)).toEqual(marker);
    expect(readStaffOrderRecovery(store, "org", "stall")).toEqual(marker);
    expect(claimStaffOrderRecovery(store, { ...marker, actorProfileId: "other", idempotencyKey: "replacement" })).toEqual(marker);
    expect(readStaffOrderRecovery(store, "org", "stall")).toEqual(marker);
    expect(readStaffOrderRecovery(store, "org", "other-stall")).toBeNull();
    expect(JSON.parse(store.getItem(staffOrderRecoveryKey("org", "stall"))!)).toEqual(marker);
  });
  it("only clears the exact resolved original identity", () => {
    const store = storage(); claimStaffOrderRecovery(store, marker);
    expect(() => clearStaffOrderRecovery(store, { ...marker, actorProfileId: "other" })).toThrow();
    expect(readStaffOrderRecovery(store, "org", "stall")).toEqual(marker);
    clearStaffOrderRecovery(store, marker);
    expect(readStaffOrderRecovery(store, "org", "stall")).toBeNull();
  });
  it("fails closed on corrupt markers and unavailable or nonpersistent storage", () => {
    const store = storage(); store.setItem(staffOrderRecoveryKey("org", "stall"), "{");
    expect(() => claimStaffOrderRecovery(store, marker)).toThrow();
    expect(() => claimStaffOrderRecovery({ ...store, getItem: () => null, setItem: () => {} }, marker)).toThrow();
    expect(() => claimStaffOrderRecovery({ ...store, getItem: () => { throw new Error("denied"); } }, marker)).toThrow();
  });
});
