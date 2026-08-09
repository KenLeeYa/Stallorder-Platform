import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createPublicOrderOperationId,
  getPublicOrderOperationId,
  normalizePublicOrderOperationId,
  PUBLIC_ORDER_OPERATION_ID_HEADER,
} from "@/lib/public-order-operation-id";

describe("public order operation id", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("normalizes only RFC 4122 version 4 UUID values", () => {
    expect(PUBLIC_ORDER_OPERATION_ID_HEADER).toBe("x-stallorder-operation-id");
    expect(normalizePublicOrderOperationId("AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA"))
      .toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(normalizePublicOrderOperationId("not-a-uuid")).toBeNull();
    expect(normalizePublicOrderOperationId("aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa")).toBeNull();
  });

  it("creates a transport id with the browser-safe UUID source", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-4111-8111-111111111111",
    });

    expect(createPublicOrderOperationId()).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("accepts a valid request header and replaces invalid external input", () => {
    vi.stubGlobal("crypto", {
      randomUUID: () => "22222222-2222-4222-8222-222222222222",
    });

    expect(getPublicOrderOperationId(new Request("https://example.test", {
      headers: { [PUBLIC_ORDER_OPERATION_ID_HEADER]: "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA" },
    }))).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
    expect(getPublicOrderOperationId(new Request("https://example.test", {
      headers: { [PUBLIC_ORDER_OPERATION_ID_HEADER]: "invalid" },
    }))).toBe("22222222-2222-4222-8222-222222222222");
  });
});
