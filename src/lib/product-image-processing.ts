import sharp from "sharp";

export const PRODUCT_IMAGE_TARGET_BYTES = 320 * 1024;
export const PRODUCT_IMAGE_MAX_INPUT_PIXELS = 50_000_000;
export type ProductImageCrop = {
  positionX: number;
  positionY: number;
  zoom: number;
};

export function calculateProductImageCrop(
  width: number,
  height: number,
  crop: ProductImageCrop,
) {
  const zoomScale = Math.min(2, Math.max(1, crop.zoom / 100));
  const size = Math.max(1, Math.floor(Math.min(width, height) / zoomScale));
  const positionX = Math.min(100, Math.max(0, crop.positionX));
  const positionY = Math.min(100, Math.max(0, crop.positionY));
  return {
    left: Math.min(width - size, Math.max(0, Math.round((width - size) * positionX / 100))),
    top: Math.min(height - size, Math.max(0, Math.round((height - size) * positionY / 100))),
    width: size,
    height: size,
  };
}
const variants = [
  { width: 1200, quality: 82 },
  { width: 1200, quality: 76 },
  { width: 960, quality: 72 },
  { width: 800, quality: 66 },
  { width: 640, quality: 58 },
  { width: 512, quality: 50 },
] as const;

export async function optimizeProductImage(bytes: Uint8Array, crop?: ProductImageCrop) {
  const input = sharp(bytes, { failOn: "error", limitInputPixels: PRODUCT_IMAGE_MAX_INPUT_PIXELS }).rotate();
  const source = crop
    ? await cropProductImage(input, crop)
    : input;
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

async function cropProductImage(input: ReturnType<typeof sharp>, crop: ProductImageCrop) {
  const normalized = await input.toBuffer({ resolveWithObject: true });
  if (!normalized.info.width || !normalized.info.height) throw new Error("IMAGE_DIMENSIONS_UNAVAILABLE");
  return sharp(normalized.data, {
    failOn: "error",
    limitInputPixels: PRODUCT_IMAGE_MAX_INPUT_PIXELS,
  }).extract(calculateProductImageCrop(normalized.info.width, normalized.info.height, crop));
}
