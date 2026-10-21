import { describe, expect, it } from "vitest";
import { assertDrBackupTarget, assertRecoveryRuleSet, fileArchiveRecord, assertFileObjectMapping, openBackup, sealBackup, restoreArguments } from "./backup-dr-for-staging.mjs";

describe("DR retirement backup boundary", () => {
  it("restores original owners and ACLs for the ordinary postgres reset role", () => {
    const args = restoreArguments("post-data");
    expect(args).toContain("--section=post-data");
    expect(args).toContain("--exit-on-error");
    expect(args).not.toContain("--no-owner");
    expect(args).not.toContain("--no-acl");
    expect(() => restoreArguments("invalid")).toThrow("RESTORE_SECTION_INVALID");
  });
  it("retains the original object path separately from its encrypted archive filename", () => {
    const object = { bucket: "product-images", name: "fixture/product.webp" };
    const archive = { name: "object-0.enc", sha256: "a".repeat(64), bytes: 90 };
    const record = fileArchiveRecord(object, archive, "b".repeat(64));
    expect(record.objectPath).toBe(object.name);
    expect(record.name).toBe(archive.name);
    expect(() => assertFileObjectMapping([record], [object])).not.toThrow();
    expect(() => assertFileObjectMapping([{ ...record, objectPath: "other.webp" }], [object])).toThrow();
    expect(() => assertFileObjectMapping([record], [])).toThrow();
  });
  it("accepts only the existing DR session pooler, never Primary", () => {
    expect(() => assertDrBackupTarget("postgresql://postgres.daeqwtpaxcebmtwxqdkj:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require")).not.toThrow();
    expect(() => assertDrBackupTarget("postgresql://postgres.eyuctbnlvnbnivwasvqr:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require")).toThrow("DR_BACKUP_TARGET_INVALID");
  });
  it("rejects redirected hosts and insecure connections", () => {
    for (const url of [
      "postgresql://postgres.daeqwtpaxcebmtwxqdkj:example-placeholder@attacker.example:5432/postgres?sslmode=require",
      "postgresql://postgres.daeqwtpaxcebmtwxqdkj:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=disable",
    ]) expect(() => assertDrBackupTarget(url)).toThrow("DR_BACKUP_TARGET_INVALID");
  });
  it("restores exact binary content using the existing backup key", () => {
    const original = Buffer.from([0, 255, 13, 10, 128, 1]);
    const archive = sealBackup(original, "test-only-backup-key");
    expect(openBackup(archive, "test-only-backup-key")).toEqual(original);
    expect(archive.includes(original)).toBe(false);
  });
  it("rejects corruption, truncation, and the wrong key", () => {
    const archive = sealBackup(Buffer.from("private fixture"), "test-only-backup-key");
    const corrupt = Buffer.from(archive);
    corrupt[corrupt.length - 1] ^= 1;
    for (const [bytes, key] of [[corrupt, "test-only-backup-key"], [archive.subarray(0, 20), "test-only-backup-key"], [archive, "wrong-key"]]) {
      expect(() => openBackup(bytes, key)).toThrow();
    }
  });
});

describe("recovery-only missing print-rule references", () => {
  const ids = ["14e82b29-5b3c-4b8a-819a-f0a16f9db2fd", "ce425c1e-c149-42e0-83b3-590268772896", "f66584a9-6357-4422-8cda-40c8a13c259d"];
  const parent = { printer_id: "fixture-printer", organization_id: "fixture-org", stall_id: "fixture-stall" };
  const columns = ["id", "printer_id", "organization_id", "stall_id"];
  const rows = ids.map((id) => ({ id, ...parent }));

  it("accepts exactly the three missing references with an existing DR parent tuple", () => {
    expect(() => assertRecoveryRuleSet(rows, columns, [parent])).not.toThrow();
  });
  it("rejects missing, duplicate or unrelated Production rows", () => {
    for (const invalid of [rows.slice(1), [rows[0], rows[0], rows[2]], [...rows, { ...rows[0], id: "unrelated" }]]) {
      expect(() => assertRecoveryRuleSet(invalid, columns, [parent])).toThrow("RECOVERY_RULE_SCOPE_INVALID");
    }
  });
  it("rejects extra columns and any new printer or tenant dependency", () => {
    expect(() => assertRecoveryRuleSet(rows.map((row) => ({ ...row, secret: "must-not-copy" })), columns, [parent]))
      .toThrow("RECOVERY_RULE_COLUMNS_INVALID");
    expect(() => assertRecoveryRuleSet(rows.map((row) => ({ ...row, organization_id: "another-org" })), columns, [parent]))
      .toThrow("RECOVERY_RULE_PARENT_MISSING");
  });
});
