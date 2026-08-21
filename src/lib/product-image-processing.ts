import sharp from "sharp";

export const PRODUCT_IMAGE_TARGET_BYTES = 320 * 1024;
export const PRODUCT_IMAGE_MAX_INPUT_PIXELS = 50_000_000;
const variants = [
  { width: 1200, quality: 82 },
  { width: 1200, quality: 76 },
  { width: 960, quality: 72 },
  { width: 800, quality: 66 },
  { width: 640, quality: 58 },
  { width: 512, quality: 50 },
] as const;

export async function optimizeProductImage(bytes: Uint8Array) {
  const source = sharp(bytes, { failOn: "error", limitInputPixels: PRODUCT_IMAGE_MAX_INPUT_PIXELS }).rotate();
  let smallest: Buffer | null = null;

  for (const variant of variants) {
    const output = await source
      .clone()
      .resize({
        width: variant.width,
        height: variant.width,
        fit: "inside",
        withoutEnlargement: true,
      })
      .webp({ quality: variant.quality, effort: 4 })
      .toBuffer();
    if (!smallest || output.byteLength < smallest.byteLength) smallest = output;
    if (output.byteLength <= PRODUCT_IMAGE_TARGET_BYTES) return output;
  }

  if (!smallest || smallest.byteLength > PRODUCT_IMAGE_TARGET_BYTES) {
    throw new Error("IMAGE_COMPRESSION_TARGET_EXCEEDED");
  }
  return smallest;
}
