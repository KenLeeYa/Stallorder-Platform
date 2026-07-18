import { createHash } from "node:crypto";

export function stallMenuCacheTag(stallId: string) {
  return `stall-menu:${stallId}`;
}

export function publicQrCacheTag(qrToken: string) {
  const digest = createHash("sha256").update(qrToken).digest("hex");
  return `public-qr:${digest}`;
}
