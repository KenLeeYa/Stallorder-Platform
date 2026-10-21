import { describe, expect, it } from "vitest";
import { decodeMobileOrderCursor, encodeMobileOrderCursor } from "./order-cursor";

describe("mobile order cursor", () => {
  it("round-trips an opaque stable cursor", () => {
    const cursor = {
      updatedAt: new Date("2026-08-25T10:30:00.000Z"),
      id: "11111111-1111-4111-8111-111111111111",
    };
    expect(decodeMobileOrderCursor(encodeMobileOrderCursor(cursor))).toEqual(cursor);
  });

  it("rejects malformed or non-UUID cursor payloads", () => {
    expect(decodeMobileOrderCursor("not-a-valid-cursor")).toBeNull();
    expect(decodeMobileOrderCursor(Buffer.from(JSON.stringify({
      updatedAt: "2026-08-25T10:30:00.000Z",
      id: "not-an-id",
    })).toString("base64url"))).toBeNull();
  });
});
