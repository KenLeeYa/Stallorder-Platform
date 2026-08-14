import { describe, expect, it } from "vitest";
import {
  AUTH_SESSION_MAX_AGE_SECONDS,
  authSessionFamilyExpiresAt,
  authSessionDeviceMatches,
  canUpgradeLegacyUnboundAuthSession,
  isAuthSessionFamilyExpired,
  nextAuthSessionCheckAt,
  nextAuthSessionExpiresAt,
  shouldRefreshAuthSession,
} from "@/lib/session-lifetime";

const NOW = Date.parse("2026-08-13T00:00:00.000Z");

describe("authenticated session lifetime", () => {
  it("keeps a signed-in staff device valid across normal shifts", () => {
    expect(AUTH_SESSION_MAX_AGE_SECONDS).toBe(7 * 24 * 60 * 60);
  });

  it("refreshes only during the final two days of a valid session", () => {
    expect(shouldRefreshAuthSession("2026-08-19T00:00:01.000Z", NOW)).toBe(false);
    expect(shouldRefreshAuthSession("2026-08-15T00:00:00.000Z", NOW)).toBe(true);
    expect(shouldRefreshAuthSession("2026-08-12T23:59:59.000Z", NOW)).toBe(false);
    expect(shouldRefreshAuthSession("invalid", NOW)).toBe(false);
  });

  it("checks at most twice daily and wakes shortly before the refresh window", () => {
    expect(nextAuthSessionCheckAt("2026-08-20T00:00:00.000Z", NOW))
      .toBe(Date.parse("2026-08-13T12:00:00.000Z"));
    expect(nextAuthSessionCheckAt("2026-08-15T01:00:00.000Z", NOW))
      .toBe(Date.parse("2026-08-13T01:00:00.000Z"));
  });

  it("requires a fresh login after thirty days even when sessions were rotated", () => {
    expect(isAuthSessionFamilyExpired(new Date("2026-07-14T00:00:00.000Z"), NOW)).toBe(true);
    expect(isAuthSessionFamilyExpired(new Date("2026-07-14T00:00:01.000Z"), NOW)).toBe(false);
  });

  it("clips a day-29 rotation to the family absolute expiry", () => {
    const firstIssuedAt = new Date("2026-07-15T00:00:00.000Z");
    const day29 = Date.parse("2026-08-13T00:00:00.000Z");
    expect(authSessionFamilyExpiresAt(firstIssuedAt).toISOString()).toBe("2026-08-14T00:00:00.000Z");
    expect(nextAuthSessionExpiresAt(firstIssuedAt, day29).toISOString()).toBe("2026-08-14T00:00:00.000Z");
  });

  it("keeps the normal seven-day expiry before the absolute boundary", () => {
    const firstIssuedAt = new Date("2026-08-01T00:00:00.000Z");
    expect(nextAuthSessionExpiresAt(firstIssuedAt, NOW).toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("binds refresh to the installed device without binding it to a browser version", () => {
    expect(authSessionDeviceMatches(null, undefined)).toBe(false);
    expect(authSessionDeviceMatches(null, "new-device")).toBe(false);
    expect(authSessionDeviceMatches("same-device", "same-device")).toBe(true);
    expect(authSessionDeviceMatches("same-device", "replacement-device")).toBe(false);
    expect(authSessionDeviceMatches("same-device", undefined)).toBe(false);
  });

  it("upgrades only still-valid legacy eight-hour sessions to device binding", () => {
    const presentedDeviceId = "11111111-1111-4111-8111-111111111111";
    expect(canUpgradeLegacyUnboundAuthSession({
      storedDeviceId: null,
      presentedDeviceId,
      issuedAt: new Date("2026-08-13T00:00:00.000Z"),
      expiresAt: new Date("2026-08-13T08:00:00.000Z"),
    })).toBe(true);
    expect(canUpgradeLegacyUnboundAuthSession({
      storedDeviceId: null,
      presentedDeviceId,
      issuedAt: new Date("2026-08-13T00:00:00.000Z"),
      expiresAt: new Date("2026-08-20T00:00:00.000Z"),
    })).toBe(false);
    expect(canUpgradeLegacyUnboundAuthSession({
      storedDeviceId: null,
      presentedDeviceId: undefined,
      issuedAt: new Date("2026-08-13T00:00:00.000Z"),
      expiresAt: new Date("2026-08-13T08:00:00.000Z"),
    })).toBe(false);
    expect(canUpgradeLegacyUnboundAuthSession({
      storedDeviceId: "22222222-2222-4222-8222-222222222222",
      presentedDeviceId,
      issuedAt: new Date("2026-08-13T00:00:00.000Z"),
      expiresAt: new Date("2026-08-13T08:00:00.000Z"),
    })).toBe(false);
  });
});
