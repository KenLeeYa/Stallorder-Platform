import { describe, expect, it } from "vitest";
import { assertDrBackupTarget, openBackup, sealBackup } from "./backup-dr-for-staging.mjs";

describe("DR retirement backup boundary", () => {
  it("accepts only the existing DR session pooler, never Primary", () => {
    expect(() => assertDrBackupTarget("postgresql://postgres.daeqwtpaxcebmtwxqdkj:fixture@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require")).not.toThrow();
    expect(() => assertDrBackupTarget("postgresql://postgres.eyuctbnlvnbnivwasvqr:fixture@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require")).toThrow("DR_BACKUP_TARGET_INVALID");
  });
  it("rejects redirected hosts and insecure connections", () => {
    for (const url of [
      "postgresql://postgres.daeqwtpaxcebmtwxqdkj:fixture@attacker.example:5432/postgres?sslmode=require",
      "postgresql://postgres.daeqwtpaxcebmtwxqdkj:fixture@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=disable",
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
