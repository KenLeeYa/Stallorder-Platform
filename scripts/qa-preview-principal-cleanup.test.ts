import { describe, expect, it } from "vitest";
import { buildPreviewPrincipalCleanupSql } from "./qa-preview-principal-cleanup";

const owned = { profileId: "12345678-1234-4123-8123-123456789012",
  sessionId: "87654321-4321-4321-8321-210987654321", tokenHash: "a".repeat(64) };
describe("bounded server-side principal cleanup", () => {
  it("binds the whole atomic statement to exact synthetic ownership and checks references before deletion", () => {
    const sql = buildPreviewPrincipalCleanupSql(owned);
    expect(sql).toContain("preview-principal-" + owned.profileId + "@stallorder.invalid");
    expect(sql).toContain(owned.tokenHash);
    expect(sql).toContain("FOR UPDATE");
    expect(sql).toContain("pg_catalog.pg_constraint");
    expect(sql).toContain("UNEXPECTED_SESSION_REFERENCE");
    expect(sql).toContain("UNEXPECTED_PROFILE_REFERENCE");
    expect(sql.indexOf("UNEXPECTED_PROFILE_REFERENCE")).toBeLessThan(sql.indexOf("DELETE FROM public.profiles"));
    expect(sql).toContain("foreign_before IS DISTINCT FROM foreign_after");
    expect(sql).toContain("OWNED_CLEANUP_INCOMPLETE");
    expect(sql).not.toContain("BEGIN TRANSACTION");
    expect(sql).not.toContain("COMMIT");
  });
  it.each(["profileId", "sessionId", "tokenHash"] as const)("rejects unsafe or missing %s before SQL construction", key => {
    for (const value of ["", "x'; DELETE FROM public.profiles; --", "a".repeat(1000), undefined]) {
      expect(() => buildPreviewPrincipalCleanupSql({ ...owned, [key]: value } as typeof owned)).toThrow();
    }
  });
});
