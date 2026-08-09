import { afterEach, describe, expect, it, vi } from "vitest";
import { createWebUuid } from "@/lib/web-uuid";

describe("createWebUuid", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("uses the browser native UUID implementation when available", () => {
    const randomUUID = vi.fn(() => "11111111-1111-4111-8111-111111111111");
    vi.stubGlobal("crypto", { randomUUID, getRandomValues: vi.fn() });

    expect(createWebUuid()).toBe("11111111-1111-4111-8111-111111111111");
    expect(randomUUID).toHaveBeenCalledOnce();
  });

  it("creates an RFC 4122 version 4 UUID with secure random bytes on HTTP LAN origins", () => {
    vi.stubGlobal("crypto", {
      getRandomValues: (bytes: Uint8Array) => bytes.fill(0),
    });

    expect(createWebUuid()).toBe("00000000-0000-4000-8000-000000000000");
  });

  it("fails closed when no secure random source exists", () => {
    vi.stubGlobal("crypto", undefined);
    expect(() => createWebUuid()).toThrow("SECURE_RANDOM_UNAVAILABLE");
  });
});
