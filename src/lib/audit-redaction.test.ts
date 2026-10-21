import { describe, expect, it } from "vitest";
import { redactAuditValue } from "./audit-redaction";
describe("audit privacy boundary", () => {
  it("removes nested credential, contact and free-text fields without discarding numeric evidence", () => {
    const result = redactAuditValue({ total: 100, customerPhone: "0900123456", data: {
      authorization: "Bearer sentinel", deliveryAddress: "private street", tokenHash: "sentinel-hash", note: "private note",
    }, endpoint: "https://user:secret@example.test/path?token=secret", lines: [{ quantity: 2 }] });
    const text = JSON.stringify(result);
    for (const secret of ["0900123456", "sentinel", "private street", "private note", "user:secret"]) expect(text).not.toContain(secret);
    expect(result).toMatchObject({ total: 100, lines: [{ quantity: 2 }] });
  });
  it("bounds depth, cycles and field counts", () => {
    const cycle: Record<string, unknown> = {}; cycle.loop = cycle;
    expect(() => redactAuditValue(cycle)).not.toThrow();
    expect(JSON.stringify(redactAuditValue(Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [String(i), "x"])))) .length).toBeLessThan(5000);
  });
  it("omits absent diagnostic fields instead of inventing a null SQL state", () => {
    expect(redactAuditValue({ sqlState: undefined, errorCode: "SAFE_CODE" })).toEqual({ errorCode: "SAFE_CODE" });
  });
});
