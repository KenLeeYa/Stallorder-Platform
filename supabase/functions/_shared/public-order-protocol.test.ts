import { describe, expect, it } from "vitest";
import {
  isSupportedPublicOrderProtocol,
  PUBLIC_ORDER_PROTOCOL_VERSION,
} from "./public-order-protocol";

describe("public order protocol", () => {
  it("keeps existing clients compatible while accepting the current version", () => {
    expect(isSupportedPublicOrderProtocol(null)).toBe(true);
    expect(isSupportedPublicOrderProtocol(PUBLIC_ORDER_PROTOCOL_VERSION)).toBe(true);
  });

  it("rejects a version that cannot preserve the shared request contract", () => {
    expect(isSupportedPublicOrderProtocol("0")).toBe(false);
    expect(isSupportedPublicOrderProtocol("2")).toBe(false);
  });
});
