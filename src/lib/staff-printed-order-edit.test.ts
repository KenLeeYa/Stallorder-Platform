import { expect, it } from "vitest";
import { getStaffOrderEditFailure } from "./staff-order-edit";

it.each(["PRINTING", "SUCCEEDED", "FAILED"])("allows merchant amendment after a %s print without recreating the order", (status) => {
  expect(getStaffOrderEditFailure({
    source: "STAFF_POS", fulfillmentType: "TAKEOUT", status: "CONFIRMED",
    paymentStatus: "UNPAID", payment: null, discountAmount: 0, discountOptionId: null,
    printJobs: [{ status }],
    items: [{ productId: null, status: "PENDING", productionTask: null, noteOptions: [{ noteOptionId: null }] }],
  })).toBeNull();
});
