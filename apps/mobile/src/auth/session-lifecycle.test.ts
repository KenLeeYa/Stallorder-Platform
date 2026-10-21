import { describe, expect, it } from "vitest";
import { millisecondsUntilSessionRefresh, shouldRefreshSession } from "./session-lifecycle";

describe("mobile session lifecycle", () => {
  const now = Date.parse("2026-08-25T10:00:00.000Z");

  it("refreshes five minutes before expiration", () => {
    expect(millisecondsUntilSessionRefresh("2026-08-25T10:10:00.000Z", now)).toBe(5 * 60_000);
    expect(shouldRefreshSession("2026-08-25T10:04:59.000Z", now)).toBe(true);
  });

  it("fails closed for an invalid expiration", () => {
    expect(shouldRefreshSession("invalid", now)).toBe(true);
  });
});
