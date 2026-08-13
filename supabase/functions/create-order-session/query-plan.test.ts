import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8")
  .replaceAll("\r\n", "\n");

describe("create-order-session lightweight query plan", () => {
  it("runs only the two context queries when the menu is omitted", () => {
    const planStart = source.indexOf("const [settingsQuery, qrQuery, fullMenuQueries]");
    const lightweightReturn = source.indexOf("if (!parsed.data.includeMenu)", planStart);
    const plan = source.slice(planStart, lightweightReturn);

    expect(planStart).toBeGreaterThan(-1);
    expect(lightweightReturn).toBeGreaterThan(planStart);
    expect(plan).toContain("parsed.data.includeMenu\n        ? Promise.all([");
    expect(plan).toContain('admin.from("stalls")');
    expect(plan).toContain('admin.from("stall_products")');
    expect(plan).toContain("parsed.data.includeMenu ? 4 : 2");
  });

  it("keeps schedule, delivery, and table validation before the lightweight return", () => {
    const scheduleValidation = source.indexOf('admin.rpc("issue_idempotent_order_session_with_schedule"');
    const planStart = source.indexOf("const [settingsQuery, qrQuery, fullMenuQueries]");
    const deliveryValidation = source.indexOf('orderingMode === "DELIVERY"', planStart);
    const tableValidation = source.indexOf('throw new HttpInputError("TABLE_UNAVAILABLE", 409)', planStart);
    const lightweightReturn = source.indexOf("if (!parsed.data.includeMenu)");
    const fullMenuBinding = source.indexOf("const [stallQuery, stallProductsQuery]", lightweightReturn);

    expect(scheduleValidation).toBeGreaterThan(-1);
    expect(deliveryValidation).toBeGreaterThan(scheduleValidation);
    expect(tableValidation).toBeGreaterThan(deliveryValidation);
    expect(lightweightReturn).toBeGreaterThan(tableValidation);
    expect(fullMenuBinding).toBeGreaterThan(lightweightReturn);
  });
});
