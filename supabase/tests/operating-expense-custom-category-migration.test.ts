import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { assertAdditiveMigrationSql } from "../../scripts/lib/additive-migration-plan.mjs";

const sql = readFileSync(
  new URL("../migrations/20260901180000_operating_expense_custom_category.sql", import.meta.url),
  "utf8",
).replace(/\r\n/g, "\n");

describe("operating expense custom category migration", () => {
  it("stores merchant-defined other expense names without promoting a global category", () => {
    expect(assertAdditiveMigrationSql(sql)).toBe(true);
    expect(sql).toContain("custom_category_name");
    expect(sql).toContain("operating_expenses_custom_category_name_check");
    expect(sql).not.toContain("global");
  });
});
