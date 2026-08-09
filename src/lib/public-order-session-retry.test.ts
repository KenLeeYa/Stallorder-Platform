import { describe, expect, it } from "vitest";
import {
  resolvePublicOrderingMode,
  shouldIncludeFullSessionMenu,
  shouldReloadResolvedSessionMenu,
  shouldRotateSessionRequestId,
} from "./public-order-session-retry";

describe("public order session request id retry policy", () => {
  it.each([
    [409, "SESSION_EXPIRED"],
    [409, "PREORDER_DISABLED"],
    [409, "PREORDER_TIME_UNAVAILABLE"],
    [409, "SESSION_TOKEN_COLLISION"],
    [409, "PREORDER_CONTEXT_UNAVAILABLE"],
    [429, "RATE_LIMITED"],
  ])("rotates after conclusive %s %s responses", (status, code) => {
    expect(shouldRotateSessionRequestId(status, code)).toBe(true);
  });

  it.each([
    [408, "ORDER_CREATE_ERROR"],
    [500, "ORDER_CREATE_ERROR"],
    [503, "QR_ORDERING_UNAVAILABLE"],
    [502, ""],
  ])("preserves the id across retryable %s responses", (status, code) => {
    expect(shouldRotateSessionRequestId(status, code)).toBe(false);
  });
});

describe("public order session menu refresh policy", () => {
  it("always requests the full PREORDER menu so the current slot cutoff is authoritative", () => {
    expect(shouldIncludeFullSessionMenu(true, "PREORDER")).toBe(true);
    expect(shouldIncludeFullSessionMenu(true, "DEFAULT")).toBe(false);
    expect(shouldIncludeFullSessionMenu(false, "DEFAULT")).toBe(true);
  });

  it("reloads the menu when the backend resolves an SSR live menu to PREORDER", () => {
    expect(shouldReloadResolvedSessionMenu("DEFAULT", "PREORDER")).toBe(true);
  });

  it("keeps the SSR menu when its ordering mode still matches", () => {
    expect(shouldReloadResolvedSessionMenu("PREORDER", "PREORDER")).toBe(false);
    expect(shouldReloadResolvedSessionMenu("DEFAULT", undefined)).toBe(false);
  });

  it("keeps a safe mode while an older session response rolls forward", () => {
    expect(resolvePublicOrderingMode(undefined, "PREORDER")).toBe("PREORDER");
    expect(resolvePublicOrderingMode("DELIVERY", "DEFAULT")).toBe("DELIVERY");
    expect(resolvePublicOrderingMode("UNKNOWN", "DEFAULT")).toBe("DEFAULT");
  });
});
