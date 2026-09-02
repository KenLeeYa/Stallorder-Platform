import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  fileURLToPath(new URL("./supply-service.ts", import.meta.url)),
  "utf8",
).replace(/\r\n/g, "\n");

describe("supply management safety boundaries", () => {
  it("archives master records instead of deleting referenced history", () => {
    expect(source).toContain('case "ARCHIVE_INGREDIENT"');
    expect(source).toContain('case "ARCHIVE_SUPPLIER"');
    expect(source).toContain('case "ARCHIVE_LOCATION"');
    expect(source).toContain("isActive: false");
    expect(source).not.toContain("supplyIngredient.delete(");
    expect(source).not.toContain("supplySupplier.delete(");
    expect(source).not.toContain("supplyLocation.delete(");
  });

  it("blocks hiding ingredients or locations while stock remains", () => {
    expect(source).toContain("SUPPLY_INGREDIENT_IN_USE");
    expect(source).toContain("SUPPLY_LOCATION_HAS_STOCK");
    expect(source).toContain("quantityMicros: { not: BigInt(0) }");
  });

  it("allows recipe removal without deleting posted movements or purchases", () => {
    expect(source).toContain('case "REMOVE_RECIPE_COMPONENT"');
    expect(source).toContain("supplyRecipeComponent.delete(");
    expect(source).not.toContain("supplyInventoryMovement.delete(");
    expect(source).not.toContain("supplyPurchaseOrder.delete(");
  });
});
