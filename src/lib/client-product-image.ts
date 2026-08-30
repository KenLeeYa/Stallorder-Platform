export const PRODUCT_IMAGE_CLIENT_MAX_INPUT_BYTES = 20 * 1024 * 1024;
export const PRODUCT_IMAGE_DIRECT_UPLOAD_MAX_BYTES = 3 * 1024 * 1024;

const resizeVariants = [
  { maxDimension: 2048, quality: 0.86 },
  { maxDimension: 1600, quality: 0.8 },
  { maxDimension: 1280, quality: 0.74 },
] as const;

export function calculateContainedImageSize(width: number, height: number, maxDimension: number) {
  if (![width, height, maxDimension].every((value) => Number.isFinite(value) && value > 0)) {
    throw new TypeError("Image dimensions must be positive finite numbers");
  }
  const scale = Math.min(1, maxDimension / Math.max(width, height));
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export async function prepareProductImageForUpload(file: File) {
  if (file.size > PRODUCT_IMAGE_CLIENT_MAX_INPUT_BYTES) {
    throw new Error("圖片原始檔不可超過 20MB。");
  }
  if (file.size <= PRODUCT_IMAGE_DIRECT_UPLOAD_MAX_BYTES) return file;

  const source = await loadImage(file);
  try {
    let smallest: Blob | null = null;
    for (const variant of resizeVariants) {
      const dimensions = calculateContainedImageSize(
        source.image.naturalWidth,
        source.image.naturalHeight,
        variant.maxDimension,
      );
      const canvas = document.createElement("canvas");
      canvas.width = dimensions.width;
      canvas.height = dimensions.height;
      const context = canvas.getContext("2d", { alpha: true });
      if (!context) throw new Error("此瀏覽器無法處理圖片，請改用 JPG、PNG 或 WebP。");
      context.drawImage(source.image, 0, 0, dimensions.width, dimensions.height);
      const blob = await canvasToBlob(canvas, "image/webp", variant.quality);
      if (!smallest || blob.size < smallest.size) smallest = blob;
      if (blob.size <= PRODUCT_IMAGE_DIRECT_UPLOAD_MAX_BYTES) {
        return new File([blob], replaceExtension(file.name, "webp"), {
          type: "image/webp",
          lastModified: file.lastModified,
        });
      }
    }
    if (!smallest || smallest.size > PRODUCT_IMAGE_DIRECT_UPLOAD_MAX_BYTES) {
      throw new Error("圖片壓縮後仍過大，請改用較小的圖片。");
    }
    return new File([smallest], replaceExtension(file.name, "webp"), {
      type: "image/webp",
      lastModified: file.lastModified,
    });
  } finally {
    source.release();
  }
}

async function loadImage(file: File) {
  const objectUrl = URL.createObjectURL(file);
  const image = new Image();
  image.decoding = "async";
  image.src = objectUrl;
  try {
    await image.decode();
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error("圖片無法解析，請改用 JPG、PNG 或 WebP。");
  }
  if (image.naturalWidth < 1 || image.naturalHeight < 1) {
    URL.revokeObjectURL(objectUrl);
    throw new Error("圖片尺寸不正確。");
  }
  return {
    image,
    release: () => URL.revokeObjectURL(objectUrl),
  };
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality: number) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error("圖片壓縮失敗，請改用 JPG、PNG 或 WebP。"));
    }, type, quality);
  });
}

function replaceExtension(fileName: string, extension: string) {
  const stem = fileName.replace(/\.[^.]+$/, "") || "product-image";
  return `${stem}.${extension}`;
}
