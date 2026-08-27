import { describe, expect, it } from "vitest";
import { loginPathForReturnPath } from "./login-routing";

describe("login entry routing", () => {
  it("routes staff and kitchen work pages through the staff login entry", () => {
    expect(loginPathForReturnPath("/staff/night-market/orders"))
      .toBe("/staff/login?next=%2Fstaff%2Fnight-market%2Forders");
    expect(loginPathForReturnPath("/kitchen"))
      .toBe("/staff/login?next=%2Fkitchen");
  });

  it("keeps merchant pages on the merchant login entry", () => {
    expect(loginPathForReturnPath("/merchant/dashboard"))
      .toBe("/login?next=%2Fmerchant%2Fdashboard");
  });
});
