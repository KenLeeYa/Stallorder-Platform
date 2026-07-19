import { describe, expect, it } from "vitest";
import { isOptimizableProductImageUrl, isRenderableProductImageUrl } from "./product-image-url";

describe("product image URL allowlist", () => {
  const supabaseUrl = "https://project-ref.supabase.co";

  it("accepts only the public product image bucket for optimization", () => {
    expect(isOptimizableProductImageUrl(
      "https://project-ref.supabase.co/storage/v1/object/public/product-images/org/product.webp",
      supabaseUrl,
    )).toBe(true);
  });

  it.each([
    "https://attacker.example/product.webp",
    "https://project-ref.supabase.co/storage/v1/object/public/other-bucket/product.webp",
    "https://user:password@project-ref.supabase.co/storage/v1/object/public/product-images/product.webp",
    "not-a-url",
  ])("rejects non-allowlisted URL %s", (value) => {
    expect(isOptimizableProductImageUrl(value, supabaseUrl)).toBe(false);
  });

  it("allows ordinary HTTPS merchant images without proxying them", () => {
    expect(isRenderableProductImageUrl("https://images.example/menu/item.webp")).toBe(true);
  });

  it.each(["javascript:alert(1)", "data:image/svg+xml;base64,AAAA", "not-a-url"])(
    "does not render unsafe URL %s",
    (value) => expect(isRenderableProductImageUrl(value)).toBe(false),
  );
});
