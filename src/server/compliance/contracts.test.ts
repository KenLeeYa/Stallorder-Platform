import { describe, expect, it } from "vitest";
import { canTransition, incidentNotificationDue, requestCommand, requestDueAt } from "./contracts";
import { seal, unseal, subjectDigest } from "./crypto";
const environment = { COMPLIANCE_FIELD_KEY: Buffer.alloc(32, 7).toString("base64") };
const scope = { organizationId: "org-a", recordId: "case-a", field: "details" };
describe("privacy control boundaries", () => {
  it.each(["ACCESS", "COPY"] as const)("counts %s from receipt across the Taipei month boundary", (type) => {
    expect(requestDueAt(new Date("2026-08-31T23:30:00+08:00"), type).toISOString()).toBe("2026-09-15T15:30:00.000Z");
  });
  it("does not extend complaints or exceed Article 13 maxima", () => {
    const received = new Date("2026-09-01T00:00:00Z");
    expect(requestDueAt(received, "DELETE", 30).toISOString()).toBe("2026-10-31T00:00:00.000Z");
    expect(() => requestDueAt(received, "ACCESS", 16)).toThrow();
    expect(() => requestDueAt(received, "DELETE", 31)).toThrow();
    expect(() => requestDueAt(received, "COMPLAINT", 1)).toThrow();
  });
  it("cannot skip verification/review or reopen completed requests", () => {
    expect(canTransition("RECEIVED", "COMPLETED")).toBe(false);
    expect(canTransition("COMPLETED", "APPROVED")).toBe(false);
    expect(canTransition("REVIEWING", "REJECTED")).toBe(true);
  });
  it("rejects client-injected scope, roles and deadlines", () => {
    expect(requestCommand.safeParse({ operationId: crypto.randomUUID(), type: "DELETE", policyVersion: "v1", details: "test", organizationId: "other", dueAt: "2099-01-01" }).success).toBe(false);
  });
  it("sets 72 hours only for the applicable digital-industry trigger", () => {
    const input = { awarenessAt: new Date("2026-09-01T00:00:00Z"), digitalIndustryApplicable: true, normalOperationsAtRisk: true, largeSubjectImpact: null };
    expect(incidentNotificationDue(input)?.toISOString()).toBe("2026-09-04T00:00:00.000Z");
    expect(incidentNotificationDue({ ...input, digitalIndustryApplicable: null })).toBeNull();
    expect(incidentNotificationDue({ ...input, normalOperationsAtRisk: false, largeSubjectImpact: false })).toBeNull();
  });
  it("authenticates encryption against tenant, record, field and tampering", () => {
    const ciphertext = seal("customer detail", scope, environment);
    expect(ciphertext).not.toContain("customer detail");
    expect(unseal(ciphertext, scope, environment)).toBe("customer detail");
    for (const changed of [{ ...scope, organizationId: "org-b" }, { ...scope, recordId: "case-b" }, { ...scope, field: "reason" }]) {
      expect(() => unseal(ciphertext, changed, environment)).toThrow("COMPLIANCE_CIPHERTEXT_INVALID");
    }
    expect(() => unseal(ciphertext.replace("v1.", "v2."), scope, environment)).toThrow();
    expect(() => seal("sensitive", scope, {})).toThrow("COMPLIANCE_KEY_REQUIRED");
    expect(subjectDigest("phone", "org-a", environment)).not.toBe(subjectDigest("phone", "org-b", environment));
  });
  it("rotates the writer while reading old versions and preserving subject/receipt identity", () => {
    const old = seal("prior case", scope, environment);
    const index = subjectDigest("receipt:operation", "org-a", environment);
    const keys = { k1: Buffer.alloc(32, 19).toString("base64"), k2: Buffer.alloc(32, 23).toString("base64") };
    const ring = { ...environment, COMPLIANCE_SUBJECT_KEY: environment.COMPLIANCE_FIELD_KEY,
      COMPLIANCE_FIELD_KEYS: JSON.stringify(keys), COMPLIANCE_ACTIVE_KEY_ID: "k1" };
    const first = seal("new case", scope, ring);
    const rotated = { ...ring, COMPLIANCE_ACTIVE_KEY_ID: "k2" };
    expect(unseal(old, scope, rotated)).toBe("prior case");
    expect(unseal(first, scope, rotated)).toBe("new case");
    expect(seal("next case", scope, rotated)).toMatch(/^v2\.k2\./);
    expect(subjectDigest("receipt:operation", "org-a", rotated)).toBe(index);
    expect(() => unseal(first.replace(".k1.", ".k2."), scope, rotated)).toThrow();
    expect(() => unseal(first, scope, { ...rotated, COMPLIANCE_FIELD_KEYS: JSON.stringify({ k2: keys.k2 }) })).toThrow();
    expect(() => seal("case", scope, { ...ring, COMPLIANCE_SUBJECT_KEY: "" })).toThrow();
  });
});
