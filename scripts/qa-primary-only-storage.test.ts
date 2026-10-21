import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";

describe("live Storage QA target boundary", () => {
  it("explicitly selects the isolated runtime in the workflow", () => {
    const workflow = readFileSync(new URL("../.github/workflows/ephemeral-preview.yml", import.meta.url), "utf8");
    const step = workflow.split("- name: Verify live Primary-only Storage on the isolated branch")[1]?.split("- name:")[0];
    expect(step).toMatch(/VERCEL_ENV:\s*"preview"/);
    expect(step).toContain("STORAGE_QA_BRANCH_REF: ${{ steps.preview.outputs.branch_ref }}");
  });
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
