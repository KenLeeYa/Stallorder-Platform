import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  buildLocalQaEnvironment,
  parseLocalQaPort,
} from "./local-qa-runtime.mjs";

describe("local QA runtime", () => {
  it.each([
    ["DIRECT_URL", "postgresql://user:do-not-log@db.example/postgres"],
    ["NEXT_PUBLIC_SUPABASE_URL", "https://production.supabase.co"],
    ["NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL", "https://production.supabase.co/functions/v1"],
    ["NEXT_PUBLIC_SUPABASE_REALTIME_URL", "wss://production.supabase.co"],
    ["SUPABASE_STORAGE_URL", "https://production.supabase.co/storage/v1"],
    ["DR_SUPABASE_URL", "https://dr.supabase.co"],
    ["SMTP_HOST", "smtp.example.com"],
    ["CUSTOM_CALLBACK_URL", "https://provider.example/callback"],
  ])("rejects inherited external destination %s before launching QA", (name, value) => {
    expect(() => buildLocalQaEnvironment(3012, {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      [name]: value,
    })).toThrow(`LOCAL_QA_EXTERNAL_DESTINATION:${name}`);
  });

  it("never forwards deployment credentials or live provider secrets to a QA child", () => {
    const result = buildLocalQaEnvironment(3012, {
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      VERCEL_TOKEN: "sentinel-provider-secret",
      VERCEL_PROJECT_ID: "primary-project",
      SUPABASE_ACCESS_TOKEN: "sentinel-management-secret",
      OPENAI_API_KEY: "sentinel-paid-api",
      PAYMENT_LINE_PAY_CHANNEL_SECRET: "sentinel-live-payment",
    });
    for (const key of ["VERCEL_TOKEN", "VERCEL_PROJECT_ID", "SUPABASE_ACCESS_TOKEN", "OPENAI_API_KEY", "PAYMENT_LINE_PAY_CHANNEL_SECRET"]) {
      expect(result[key]).toBeUndefined();
    }
    expect(result.EXTERNAL_DISPATCH_ENABLED).toBe("false");
  });

  it("keeps every application origin on the requested fixed port", () => {
    const environment = buildLocalQaEnvironment(3012, {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
      REPORT_DELIVERY_MODE: "live",
      PAYMENT_PROVIDER_MODE: "live",
    });

    expect(environment.APP_BASE_URL).toBe("http://127.0.0.1:3012");
    expect(environment.NEXT_PUBLIC_APP_URL).toBe("http://127.0.0.1:3012");
    expect(environment.PUBLIC_ORDER_FUNCTION_ORIGIN).toBe("http://127.0.0.1:3012");
    expect(environment.LOCAL_DEV_ALLOWED_ORIGINS).toBe("http://127.0.0.1:3012");
    expect(environment.LOCAL_QA_QUICK_LOGIN_ENABLED).toBe("true");
    expect(environment.REPORT_DELIVERY_MODE).toBe("simulate");
    expect(environment.PAYMENT_PROVIDER_MODE).toBe("mock");
    expect(environment.NEXT_PUBLIC_ENABLE_PWA_IN_DEVELOPMENT).toBe("false");
    expect(environment.NEXT_PUBLIC_FORCE_PUBLIC_ORDER_CIRCUIT_B).toBe("true");
    expect(environment.NEXT_PUBLIC_TURNSTILE_SITE_KEY).toBe("1x00000000000000000000AA");
  });

  it("loads the local-only public order secrets before starting Next.js", () => {
    const launcher = readFileSync(
      fileURLToPath(new URL("./start-local-qa.mjs", import.meta.url)),
      "utf8",
    ).replace(/\r\n/g, "\n");

    expect(launcher).toContain('"supabase/functions/e2e-runtime.defaults"');
    expect(launcher).toContain('warmLocalQaPage(`${origin}/login`)');
    expect(launcher).toContain('warmLocalQaPage(`${origin}/api/availability/config`)');
    expect(launcher).toContain('warmLocalQaLoginApi(`${origin}/api/auth/login`, origin)');
  });

  it("rejects production mode, remote databases, and automatic port changes", () => {
    expect(() => buildLocalQaEnvironment(3012, {
      NODE_ENV: "production",
      DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    })).toThrow("LOCAL_QA_PRODUCTION_MODE_BLOCKED");
    expect(() => buildLocalQaEnvironment(3012, {
      NODE_ENV: "development",
      DATABASE_URL: "postgresql://postgres:postgres@db.example/postgres",
    })).toThrow("LOCAL_QA_DATABASE_MUST_BE_LOOPBACK");
    expect(parseLocalQaPort(["--port", "3012"])).toBe(3012);
    expect(() => parseLocalQaPort(["--port", "0"])).toThrow("LOCAL_QA_PORT_INVALID");
  });
});
