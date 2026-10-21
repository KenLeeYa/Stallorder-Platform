import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { configurePreviewOrderRuntime } from "./configure-preview-order-runtime";

const ref = "abcdefghijklmnopqrst";
const input = {
  ref, parentRef: "eyuctbnlvnbnivwasvqr", supabaseUrl: `https://${ref}.supabase.co`,
  databaseUrl: `postgresql://postgres.${ref}:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`,
  token: "test-provider-credential", abuseSecret: "a".repeat(64), tokenSecret: "b".repeat(64),
};

describe("isolated Preview public-order runtime", () => {
  it("provisions independent order secrets and verifies provider digests before QA", async () => {
    let values: Array<{ name: string; value: string }> = [];
    const provider = vi.fn(async (url: string | URL | Request, options?: RequestInit) => {
      expect(String(url)).toBe(`https://api.supabase.com/v1/projects/${ref}/secrets`);
      if (options?.method === "POST") {
        values = JSON.parse(String(options.body));
        return Response.json({});
      }
      return Response.json(values.map(({ name, value }) => ({
        name, value: createHash("sha256").update(value).digest("hex"),
      })));
    });
    await configurePreviewOrderRuntime(input, provider);
    expect(Object.fromEntries(values.map(({ name, value }) => [name, value]))).toEqual({
      ABUSE_HASH_SECRET: input.abuseSecret, TOKEN_DERIVATION_SECRET: input.tokenSecret,
      TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", APP_ENV: "test",
      TURNSTILE_ALLOW_TEST_KEYS: "true", PUBLIC_APP_ORIGINS: "http://127.0.0.1:3000",
      TRUSTED_CLIENT_IP_HEADER: "cf-connecting-ip",
    });
    expect(provider).toHaveBeenCalledTimes(2);
  });

  it("rejects either live project and mismatched targets before provider writes", async () => {
    for (const invalid of [
      { ...input, ref: input.parentRef }, { ...input, ref: "daeqwtpaxcebmtwxqdkj" },
      { ...input, supabaseUrl: "https://eyuctbnlvnbnivwasvqr.supabase.co" },
      { ...input, databaseUrl: input.databaseUrl.replace(ref, input.parentRef) },
      { ...input, tokenSecret: input.abuseSecret },
    ]) {
      const provider = vi.fn();
      await expect(configurePreviewOrderRuntime(invalid, provider)).rejects.toThrow();
      expect(provider).not.toHaveBeenCalled();
    }
  });

  it("rejects missing or stale provider digest readback", async () => {
    const provider = vi.fn().mockResolvedValueOnce(Response.json({})).mockResolvedValueOnce(Response.json([]));
    await expect(configurePreviewOrderRuntime(input, provider)).rejects.toThrow("PREVIEW_ORDER_SECRET_DIGEST_MISMATCH");
  });

  it("wires independent secrets into Edge and the application before real browser QA", () => {
    const source = readFileSync(new URL("../.github/workflows/ephemeral-preview.yml", import.meta.url), "utf8");
    const step = (name: string) => source.split(`- name: ${name}`)[1]?.split("- name:")[0] ?? "";
    const setup = step("Configure isolated public-order Edge runtime");
    expect(setup).toContain('VERCEL_ENV: "preview"');
    expect(setup).toContain("PREVIEW_ORDER_BRANCH_REF: ${{ steps.preview.outputs.branch_ref }}");
    expect(setup).toContain("scripts/configure-preview-order-runtime.ts");
    for (const name of ["ABUSE_HASH_SECRET", "TOKEN_DERIVATION_SECRET"]) {
      expect(step("Generate isolated Preview-only secrets")).toContain(name);
      expect(step("Deploy matching Vercel Preview")).toContain(`--env "${name}=$${name}"`);
    }
    expect(step("Verify real public-order browser flow"))
      .toContain("scripts/qa-preview-public-order.ts");
  });
});
