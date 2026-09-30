// Only transaction identity is durable. Payloads and customer information stay in memory.
export type StaffOrderRecovery = {
  version: 1;
  organizationId: string;
  stallId: string;
  actorProfileId: string;
  idempotencyKey: string;
  paymentTiming: "PAY_NOW" | "PAY_LATER";
  cash: boolean;
  draftId: string | null;
};
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export function staffOrderRecoveryKey(organizationId: string, stallId: string) {
  return `stallorder_staff_order_recovery:${encodeURIComponent(organizationId)}:${encodeURIComponent(stallId)}`;
}
export function readStaffOrderRecovery(storage: RecoveryStorage, organizationId: string, stallId: string): StaffOrderRecovery | null {
  const raw = storage.getItem(staffOrderRecoveryKey(organizationId, stallId));
  if (raw === null) return null;
  const value = JSON.parse(raw) as StaffOrderRecovery;
  if (!value || value.version !== 1 || value.organizationId !== organizationId || value.stallId !== stallId
    || typeof value.actorProfileId !== "string" || !value.actorProfileId
    || typeof value.idempotencyKey !== "string" || !value.idempotencyKey
    || !["PAY_NOW", "PAY_LATER"].includes(value.paymentTiming) || typeof value.cash !== "boolean"
    || (value.draftId !== null && typeof value.draftId !== "string")) throw new Error("RECOVERY_STORAGE_INVALID");
  return { version: 1, organizationId, stallId, actorProfileId: value.actorProfileId, idempotencyKey: value.idempotencyKey,
    paymentTiming: value.paymentTiming, cash: value.cash, draftId: value.draftId };
}
// Caller holds a browser lock spanning this read/write/readback. Never replace an existing attempt.
export function claimStaffOrderRecovery(storage: RecoveryStorage, marker: StaffOrderRecovery) {
  const existing = readStaffOrderRecovery(storage, marker.organizationId, marker.stallId);
  if (existing) return existing;
  storage.setItem(staffOrderRecoveryKey(marker.organizationId, marker.stallId), JSON.stringify(marker));
  const saved = readStaffOrderRecovery(storage, marker.organizationId, marker.stallId);
  if (!saved || JSON.stringify(saved) !== JSON.stringify(marker)) throw new Error("RECOVERY_STORAGE_UNAVAILABLE");
  return saved;
}
export function clearStaffOrderRecovery(storage: RecoveryStorage, marker: StaffOrderRecovery) {
  const existing = readStaffOrderRecovery(storage, marker.organizationId, marker.stallId);
  if (!existing) return; // Another tab may already have reconciled this known result.
  if (existing.actorProfileId !== marker.actorProfileId || existing.idempotencyKey !== marker.idempotencyKey) throw new Error("RECOVERY_IDENTITY_CHANGED");
  storage.removeItem(staffOrderRecoveryKey(marker.organizationId, marker.stallId));
  if (readStaffOrderRecovery(storage, marker.organizationId, marker.stallId)) throw new Error("RECOVERY_STORAGE_UNAVAILABLE");
}
