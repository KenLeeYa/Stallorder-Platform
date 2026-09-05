import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const dashboardSource = readFileSync(
  fileURLToPath(new URL("./operating-profit-dashboard.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

const serviceSource = readFileSync(
  fileURLToPath(new URL("../server/finance/operating-profit-service.ts", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

const supplySource = readFileSync(
  fileURLToPath(new URL("./supply-lite-manager.tsx", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

const supplyServiceSource = readFileSync(
  fileURLToPath(new URL("../server/supply-lite/supply-service.ts", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("operating profit cost architecture", () => {
  it("reports food and disposable packaging costs separately", () => {
    expect(serviceSource).toContain("food_cost");
    expect(serviceSource).toContain("packaging_cost");
    expect(serviceSource).toContain("ingredient.item_type = 'INGREDIENT'");
    expect(serviceSource).toContain("ingredient.item_type = 'PACKAGING'");
    expect(dashboardSource).toContain('label="食材成本"');
    expect(dashboardSource).toContain('label="一次性包材成本"');
  });

  it("keeps reusable equipment out of product recipe choices", () => {
    expect(supplySource).toContain('REUSABLE_EQUIPMENT: "可重複使用餐具／設備"');
    expect(supplySource).toContain('item.itemType === "INGREDIENT" || item.itemType === "PACKAGING"');
    expect(supplyServiceSource).toContain('throw new SupplyOperationError("SUPPLY_RECIPE_ITEM_TYPE_INVALID")');
  });

  it("shows a merchant-only custom name field for other expenses", () => {
    expect(dashboardSource).toContain('name="customCategoryName"');
    expect(dashboardSource).toContain("customExpenseCategoryNames");
  });

  it("shows expense action results in the shared centered dialog", () => {
    expect(dashboardSource).toContain("<SettingsFeedbackDialog");
    expect(dashboardSource).not.toContain('{message ? <p role="status"');
  });
});
