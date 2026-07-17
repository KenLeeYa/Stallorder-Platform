import { describe, expect, it } from "vitest";
import { hasExpectedImageSignature } from "./image-upload";

describe("商品圖片檔案簽章", () => {
  it("接受 JPEG、PNG 與 WebP 的正確檔頭", () => {
    expect(hasExpectedImageSignature(new Uint8Array([0xff, 0xd8, 0xff, 0x00]), "image/jpeg")).toBe(true);
    expect(hasExpectedImageSignature(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), "image/png")).toBe(true);
    expect(hasExpectedImageSignature(new TextEncoder().encode("RIFF0000WEBP"), "image/webp")).toBe(true);
  });

  it("拒絕僅偽造 MIME 的文字內容", () => {
    const text = new TextEncoder().encode("<script>alert(1)</script>");
    expect(hasExpectedImageSignature(text, "image/jpeg")).toBe(false);
    expect(hasExpectedImageSignature(text, "image/png")).toBe(false);
    expect(hasExpectedImageSignature(text, "image/webp")).toBe(false);
  });
});
