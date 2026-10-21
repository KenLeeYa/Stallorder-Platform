import { randomBytes } from "node:crypto";

export function generateResponsiveQrToken() {
  return `responsive-qa-${randomBytes(32).toString("base64url")}`;
}
