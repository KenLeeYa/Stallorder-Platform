import { describe, expect, it } from "vitest";
import { parseQueuePreferences } from "./staff-queue-preferences";

describe("queue presentation preferences", () => {
  it("restores valid choices without retaining customer, query or order fields", () => {
    expect(parseQueuePreferences(JSON.stringify({ filter: "READY", source: "QR_MENU", recentOnly: true, query: "private", orderId: "private" }))).toEqual({ filter: "READY", source: "QR_MENU", recentOnly: true });
  });
  it.each(["", "not-json", "null", "[]", '{"filter":"COMPLETED","source":"OTHER","recentOnly":"true"}'])("safely defaults malformed or retired preferences: %s", raw => {
    expect(parseQueuePreferences(raw)).toEqual({ filter: "ALL", source: "ALL", recentOnly: false });
  });
});
