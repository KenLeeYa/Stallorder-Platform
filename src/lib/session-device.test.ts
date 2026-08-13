import { afterEach, describe, expect, it, vi } from "vitest";
import { NextResponse } from "next/server";
import { setSessionCookies } from "@/lib/auth";
import {
  resolveSessionDeviceId,
  SESSION_DEVICE_COOKIE,
  SESSION_DEVICE_MAX_AGE_SECONDS,
} from "@/lib/security";

const DEVICE_ID = "11111111-1111-4111-8111-111111111111";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("authenticated session device binding", () => {
  it("reuses an existing valid device cookie and normalizes its casing", () => {
    const request = new Request("https://app.qidaigo.com/login", {
      headers: { cookie: `other=value; ${SESSION_DEVICE_COOKIE}=${DEVICE_ID.toUpperCase()}` },
    });

    expect(resolveSessionDeviceId(request)).toBe(DEVICE_ID);
  });

  it("generates a new UUID when the device cookie is missing or malformed", () => {
    const missing = resolveSessionDeviceId(new Request("https://app.qidaigo.com/login"));
    const malformed = resolveSessionDeviceId(new Request("https://app.qidaigo.com/login", {
      headers: { cookie: `${SESSION_DEVICE_COOKIE}=not-a-uuid` },
    }));

    expect(missing).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(malformed).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(malformed).not.toBe(missing);
  });

  it("sets a one-year HttpOnly Secure authentication-device cookie in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const response = NextResponse.json({ ok: true });

    setSessionCookies(response, {
      token: "session-token",
      csrfToken: "csrf-token",
      expiresAt: new Date("2026-08-20T00:00:00.000Z"),
      deviceId: DEVICE_ID,
    }, DEVICE_ID);

    const deviceCookie = response.headers.getSetCookie()
      .find((cookie) => cookie.startsWith(`${SESSION_DEVICE_COOKIE}=`));
    expect(deviceCookie).toContain(`Max-Age=${SESSION_DEVICE_MAX_AGE_SECONDS}`);
    expect(deviceCookie).toContain("Path=/");
    expect(deviceCookie).toContain("SameSite=lax");
    expect(deviceCookie).toContain("Secure");
    expect(deviceCookie).toContain("HttpOnly");
    expect(deviceCookie).toContain("stallorder_auth_device=");
  });

  it("rejects writing a device cookie that differs from the stored session binding", () => {
    const response = NextResponse.json({ ok: true });

    expect(() => setSessionCookies(response, {
      token: "session-token",
      csrfToken: "csrf-token",
      expiresAt: new Date("2026-08-20T00:00:00.000Z"),
      deviceId: DEVICE_ID,
    }, "22222222-2222-4222-8222-222222222222")).toThrow("SESSION_DEVICE_MISMATCH");
  });
});
