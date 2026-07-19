import sharp from "sharp";

const targetBytes = 200 * 1024;
const variants = [
  { width: 800, quality: 78 },
  { width: 800, quality: 68 },
  { width: 640, quality: 60 },
] as const;

export async function optimizeProductImage(bytes: Uint8Array) {
  const source = sharp(bytes, { failOn: "error", limitInputPixels: 40_000_000 }).rotate();
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
    if (output.byteLength <= targetBytes) return output;
  }

  return smallest!;
}
