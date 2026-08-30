import { describe, expect, it } from "vitest";
import {
  calculateContainedImageSize,
  PRODUCT_IMAGE_DIRECT_UPLOAD_MAX_BYTES,
} from "@/lib/client-product-image";

describe("client product image preparation", () => {
  it("keeps the whole image aspect ratio while bounding the longest edge", () => {
    expect(calculateContainedImageSize(4000, 3000, 1600)).toEqual({ width: 1600, height: 1200 });
    expect(calculateContainedImageSize(1200, 1600, 2048)).toEqual({ width: 1200, height: 1600 });
  });

  it("keeps multipart uploads below the cloud request ingress limit", () => {
    expect(PRODUCT_IMAGE_DIRECT_UPLOAD_MAX_BYTES).toBe(3 * 1024 * 1024);
  });
});
