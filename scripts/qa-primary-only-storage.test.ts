import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { assertIsolatedStorageQa, runStorageQa } from "./qa-primary-only-storage";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

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

describe("live Storage QA key-lookup diagnostics", () => {
  const ref = "abcdefghijklmnopqrst";

  it.each([
    [401, "application/json", "30", "json", 30],
    [403, "text/html; charset=utf-8", "private-placeholder", "html", null],
    [429, "application/json", "999999999", "json", null],
    [503, "application/private-placeholder", "-1", "other", null],
  ])("retains safe status for HTTP %i without secrets or a retry", async (
    status, contentType, retryAfter, expectedType, expectedRetry,
  ) => {
    vi.stubEnv("GITHUB_ACTIONS", "true");
    vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("GITHUB_REPOSITORY", "KenLeeYa/Stallorder-Platform");
    vi.stubEnv("STORAGE_QA_BRANCH_REF", ref);
    vi.stubEnv("SUPABASE_PARENT_PROJECT_REF", "eyuctbnlvnbnivwasvqr");
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", `https://${ref}.supabase.co`);
    vi.stubEnv("DATABASE_URL", `postgresql://postgres.${ref}:example-placeholder@aws-0-ap-northeast-1.pooler.supabase.com:5432/postgres`);
    vi.stubEnv("SUPABASE_ACCESS_TOKEN", "management-token-placeholder");
    const diagnostics = vi.spyOn(console, "error").mockImplementation(() => {});
    const progress = vi.spyOn(console, "log").mockImplementation(() => {});
    const realFetch = globalThis.fetch;
    let requests = 0;
    const server = createServer((_request, response) => {
      requests++;
      response.writeHead(status, {
        "Content-Type": contentType, "Retry-After": retryAfter,
        "Set-Cookie": "private-cookie-placeholder",
        "Location": "https://private.example/?token=private-placeholder",
      });
      response.end('{"api_key":"service-key-placeholder","message":"private-placeholder"}');
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const address = server.address();
      if (!address || typeof address === "string") throw new Error("fixture address unavailable");
      const fetchSpy = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe(`https://api.supabase.com/v1/projects/${ref}/api-keys?reveal=true`);
        expect(init?.headers).toEqual({ Authorization: "Bearer management-token-placeholder" });
        expect(init?.redirect).toBe("error");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return realFetch(`http://127.0.0.1:${address.port}`, init);
      });
      vi.stubGlobal("fetch", fetchSpy);
      await expect(runStorageQa()).rejects.toThrow("STORAGE_QA_KEY_LOOKUP_FAILED");
      expect(requests).toBe(1);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      expect(progress).not.toHaveBeenCalled();
      expect(diagnostics).toHaveBeenCalledExactlyOnceWith("STORAGE_QA_KEY_LOOKUP_DIAGNOSTIC", {
        status, contentType: expectedType, retryAfterSeconds: expectedRetry,
      });
      expect(JSON.stringify(diagnostics.mock.calls)).not.toMatch(/placeholder|Authorization|api_key|https?:/);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });
});
