import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { optimizeProductImage, PRODUCT_IMAGE_TARGET_BYTES } from "./product-image-processing";

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
    expect(metadata.width).toBeLessThanOrEqual(1200);
    expect(metadata.height).toBeLessThanOrEqual(1200);
    expect(output.byteLength).toBeLessThanOrEqual(PRODUCT_IMAGE_TARGET_BYTES);
  });

  it("compresses a large detailed photo below the storage target", async () => {
    const width = 2_000;
    const height = 1_500;
    const pixels = Buffer.alloc(width * height * 3);
    let state = 0x12345678;
    for (let index = 0; index < pixels.length; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      pixels[index] = state & 0xff;
    }
    const input = await sharp(pixels, { raw: { width, height, channels: 3 } })
      .jpeg({ quality: 95 })
      .toBuffer();

    expect(input.byteLength).toBeGreaterThan(PRODUCT_IMAGE_TARGET_BYTES);
    const output = await optimizeProductImage(input);
    const metadata = await sharp(output).metadata();

    expect(output.byteLength).toBeLessThanOrEqual(PRODUCT_IMAGE_TARGET_BYTES);
    expect(output.byteLength).toBeLessThan(input.byteLength);
    expect(metadata.width).toBeLessThanOrEqual(1_200);
    expect(metadata.height).toBeLessThanOrEqual(1_200);
  });

  it("applies EXIF orientation and strips the orientation metadata", async () => {
    const input = await sharp({
      create: {
        width: 600,
        height: 900,
        channels: 3,
        background: { r: 224, g: 120, b: 42 },
      },
    }).jpeg().withMetadata({ orientation: 6 }).toBuffer();

    const output = await optimizeProductImage(input);
    const metadata = await sharp(output).metadata();

    expect(metadata.width).toBe(900);
    expect(metadata.height).toBe(600);
    expect(metadata.orientation).toBeUndefined();
  });

  it("rejects bytes that are not a decodable image", async () => {
    await expect(optimizeProductImage(new Uint8Array([1, 2, 3, 4]))).rejects.toThrow();
  });
});
