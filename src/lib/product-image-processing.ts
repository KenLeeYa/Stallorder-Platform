import type { Sharp } from "sharp";

export const PRODUCT_IMAGE_TARGET_BYTES = 320 * 1024;
export const PRODUCT_IMAGE_MAX_INPUT_PIXELS = 20_000_000;
export type ProductImageCrop = {
  positionX: number;
  positionY: number;
  zoom: number;
};

type SharpFactory = (typeof import("sharp"))["default"];

export class ProductImageProcessorUnavailableError extends Error {
  readonly code = "PRODUCT_IMAGE_PROCESSOR_UNAVAILABLE";

  constructor() {
    super("PRODUCT_IMAGE_PROCESSOR_UNAVAILABLE");
    this.name = "ProductImageProcessorUnavailableError";
  }
}

export class ProductImageProcessingBusyError extends Error {
  readonly code = "PRODUCT_IMAGE_PROCESSING_BUSY";

  constructor() {
    super("PRODUCT_IMAGE_PROCESSING_BUSY");
    this.name = "ProductImageProcessingBusyError";
  }
}

const activeByOrganization = new Map<string, number>();
let activeGlobally = 0;

export async function withProductImageProcessingSlot<T>(
  organizationId: string,
  task: () => Promise<T>,
) {
  if ((activeByOrganization.get(organizationId) ?? 0) >= 1 || activeGlobally >= 4) {
    throw new ProductImageProcessingBusyError();
  }
  activeByOrganization.set(organizationId, 1);
  activeGlobally += 1;
  try {
    return await task();
  } finally {
    activeGlobally -= 1;
    activeByOrganization.delete(organizationId);
  }
}

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
  const sharp = await loadSharp();
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

async function loadSharp(): Promise<SharpFactory> {
  try {
    return (await import("sharp")).default;
  } catch {
    throw new ProductImageProcessorUnavailableError();
  }
}

async function cropProductImage(input: Sharp, crop: ProductImageCrop) {
  const metadata = await input.clone().metadata();
  if (!metadata.width || !metadata.height) throw new Error("IMAGE_DIMENSIONS_UNAVAILABLE");
  const swapsDimensions = metadata.orientation !== undefined
    && metadata.orientation >= 5
    && metadata.orientation <= 8;
  const width = swapsDimensions ? metadata.height : metadata.width;
  const height = swapsDimensions ? metadata.width : metadata.height;
  return input.clone().extract(calculateProductImageCrop(width, height, crop));
}
