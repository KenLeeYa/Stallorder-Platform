import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeProductImage } from "./product-image-processing";

describe("product image processing", () => {
  it("normalizes uploads to a practical WebP thumbnail", async () => {
    const input = await sharp({
      create: {
        width: 1_600,
        height: 1_200,
        channels: 4,
        background: { r: 18, g: 140, b: 126, alpha: 1 },
      },
    }).png().toBuffer();

    const output = await optimizeProductImage(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.format).toBe("webp");
    expect(metadata.width).toBeLessThanOrEqual(800);
    expect(metadata.height).toBeLessThanOrEqual(800);
    expect(output.byteLength).toBeLessThanOrEqual(200 * 1024);
  });

  it("rejects bytes that are not a decodable image", async () => {
    await expect(optimizeProductImage(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
