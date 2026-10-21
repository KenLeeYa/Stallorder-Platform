import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertIsolatedStorageQa } from "./qa-primary-only-storage";

type Input = Parameters<typeof assertIsolatedStorageQa>[0] & {
  token: string; abuseSecret: string; tokenSecret: string;
};

export async function configurePreviewOrderRuntime(input: Input, fetchImpl: typeof fetch = fetch) {
  assertIsolatedStorageQa(input);
  assert.ok(input.token && input.abuseSecret.length >= 32 && input.tokenSecret.length >= 32
    && input.abuseSecret !== input.tokenSecret, "PREVIEW_ORDER_SECRETS_INVALID");
  const values = {
    ABUSE_HASH_SECRET: input.abuseSecret, TOKEN_DERIVATION_SECRET: input.tokenSecret,
    TURNSTILE_SECRET_KEY: "1x0000000000000000000000000000000AA", APP_ENV: "test",
    TURNSTILE_ALLOW_TEST_KEYS: "true", PUBLIC_APP_ORIGINS: "http://127.0.0.1:3000",
    TRUSTED_CLIENT_IP_HEADER: "cf-connecting-ip",
  };
  const url = `https://api.supabase.com/v1/projects/${input.ref}/secrets`;
  const headers = { authorization: `Bearer ${input.token}`, "content-type": "application/json" };
  const saved = await fetchImpl(url, { method: "POST", headers, redirect: "error",
    signal: AbortSignal.timeout(20_000),
    body: JSON.stringify(Object.entries(values).map(([name, value]) => ({ name, value }))),
  });
  assert.ok(saved.ok, "PREVIEW_ORDER_CONFIGURATION_FAILED");
  const response = await fetchImpl(url, { headers, redirect: "error", signal: AbortSignal.timeout(20_000) });
  assert.ok(response.ok, "PREVIEW_ORDER_READBACK_FAILED");
  const actual = await response.json() as Array<{ name: string; value: string }>;
  for (const [name, value] of Object.entries(values)) {
    assert.equal(actual.find((item) => item.name === name)?.value,
      createHash("sha256").update(value).digest("hex"), "PREVIEW_ORDER_SECRET_DIGEST_MISMATCH");
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  void (async () => {
    assert.ok(process.env.GITHUB_ACTIONS === "true" && process.env.VERCEL_ENV === "preview"
      && process.env.GITHUB_REPOSITORY === "KenLeeYa/Stallorder-Platform", "PREVIEW_ORDER_INVOCATION_INVALID");
    const required = (name: string) => {
      assert.ok(process.env[name]?.trim(), "PREVIEW_ORDER_CONFIGURATION_MISSING");
      return process.env[name]!.trim();
    };
    await configurePreviewOrderRuntime({ ref: required("PREVIEW_ORDER_BRANCH_REF"),
      parentRef: required("SUPABASE_PARENT_PROJECT_REF"), supabaseUrl: required("NEXT_PUBLIC_SUPABASE_URL"),
      databaseUrl: required("DATABASE_URL"), token: required("SUPABASE_ACCESS_TOKEN"),
      abuseSecret: required("ABUSE_HASH_SECRET"), tokenSecret: required("TOKEN_DERIVATION_SECRET"),
    });
    console.log("PASS: independent Preview order secrets provisioned and digest-verified.");
  })().catch(() => {
    console.error("PREVIEW_ORDER_RUNTIME_CONFIGURATION_FAILED");
    process.exitCode = 1;
  });
}
