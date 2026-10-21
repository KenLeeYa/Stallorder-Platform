import { describe, expect, it } from "vitest";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";

describe("live Storage QA target boundary", () => {
  const ref = "abcdefghijklmnopqrst";
  const input = {
    ref,
    parentRef: "eyuctbnlvnbnivwasvqr",
    supabaseUrl: `https://${ref}.supabase.co`,
    databaseUrl: `postgresql://postgres.${ref}:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres?sslmode=require`,
  };

  it("accepts matching isolated API and database targets", () => {
    expect(() => assertIsolatedStorageQa(input)).not.toThrow();
  });

  it("rejects either live project, a parent branch or a mismatched database", () => {
    for (const invalid of [
      { ...input, ref: "eyuctbnlvnbnivwasvqr" },
      { ...input, ref: "daeqwtpaxcebmtwxqdkj" },
      { ...input, parentRef: ref },
      { ...input, databaseUrl: input.databaseUrl.replace(ref, "another-project") },
      { ...input, databaseUrl: `${input.databaseUrl}&hostaddr=127.0.0.1` },
      { ...input, supabaseUrl: "https://attacker.example" },
    ]) expect(() => assertIsolatedStorageQa(invalid)).toThrow("STORAGE_QA_TARGET_INVALID");
  });
});
