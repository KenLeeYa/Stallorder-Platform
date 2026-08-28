import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const migration = readFileSync(join(
  process.cwd(),
  "supabase/migrations/20260828190000_private_product_image_delivery.sql",
), "utf8");

describe("private product image delivery migration", () => {
  it("closes direct bucket reads and rewrites legacy public URLs to the application proxy", () => {
    expect(migration).toMatch(/set public = false/i);
    expect(migration).toMatch(/drop policy if exists product_images_public_read/i);
    expect(migration).toMatch(/update public\.products/i);
    expect(migration).toMatch(/update public\.stalls/i);
    expect(migration).toMatch(/\/api\/assets\/product-images\//i);
  });
});
