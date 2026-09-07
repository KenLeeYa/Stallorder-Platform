import { describe, expect, it } from "vitest";
import { findOrderClosureNotice } from "./order-closure-notice";

const closure = { id: "closure", startsOn: "2026-09-08", endsOn: "2026-09-08", title: "臨時店休", message: "設備維修", opensAt: null, closesAt: null };
describe("existing preorder closure notices", () => {
  it("finds a closure using the store date rather than the UTC date", () => {
    expect(findOrderClosureNotice([closure], "Asia/Taipei", ["2026-09-07T17:00:00Z"])?.closure.id).toBe("closure");
    expect(findOrderClosureNotice([closure], "Asia/Taipei", ["2026-09-07T12:00:00Z"])).toBeNull();
  });
  it("respects special opening hours and checks a newly proposed time too", () => {
    const partial = { ...closure, opensAt: "11:00", closesAt: "14:00" };
    expect(findOrderClosureNotice([partial], "Asia/Taipei", ["2026-09-08T04:00:00Z"])).toBeNull();
    expect(findOrderClosureNotice([partial], "Asia/Taipei", ["2026-09-08T04:00:00Z", "2026-09-08T07:00:00Z"])?.fulfillmentAt).toBe("2026-09-08T07:00:00Z");
  });
  it("does not turn an absent or invalid pickup time into a closure warning", () => {
    expect(findOrderClosureNotice([closure], "Asia/Taipei", [null, "bad-date"])).toBeNull();
    expect(findOrderClosureNotice([], "Asia/Taipei", ["2026-09-08T04:00:00Z"])).toBeNull();
  });
});
