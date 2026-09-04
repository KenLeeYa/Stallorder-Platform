import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const source = readFileSync(fileURLToPath(new URL("./index.ts", import.meta.url)), "utf8");

describe("create-public-order PREORDER customer phone", () => {
  it("persists a normalized phone for both new and idempotently replayed PREORDER orders", () => {
    expect(source).toContain("async function persistPreorderCustomerPhone(");
    expect(source).toContain('.update({ customer_phone: customerPhone.trim().slice(0, 30) })');
    expect(source).toContain('.is("customer_phone", null)');
    expect(source.match(/persistPreorderCustomerPhone\(admin,/gu)).toHaveLength(2);
  });
});
