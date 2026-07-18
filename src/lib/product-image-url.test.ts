import { describe, expect, it } from "vitest";
import { isOptimizableProductImageUrl } from "./product-image-url";

describe("product image URL allowlist", () => {
  const supabaseUrl = "https://project-ref.supabase.co";

  it("accepts only the public product image bucket", () => {
    expect(isOptimizableProductImageUrl(
      "https://project-ref.supabase.co/storage/v1/object/public/product-images/org/product.webp",
      supabaseUrl,
    )).toBe(true);
  });

  it.each([
    "https://attacker.example/product.webp",
    "https://project-ref.supabase.co/storage/v1/object/public/other-bucket/product.webp",
    "not-a-url",
  ])("rejects non-allowlisted URL %s", (value) => {
    expect(isOptimizableProductImageUrl(value, supabaseUrl)).toBe(false);
  });
});
