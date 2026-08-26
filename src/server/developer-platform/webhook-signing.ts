import { createHmac, timingSafeEqual } from "node:crypto";

export function createWebhookSignature(input: {
  secret: string;
  timestamp: string;
  payload: string;
}) {
  const digest = createHmac("sha256", input.secret)
    .update(`${input.timestamp}.${input.payload}`, "utf8")
    .digest("hex");
  return `v1=${digest}`;
}

export function verifyWebhookSignature(input: {
  secret: string;
  timestamp: string;
  payload: string;
  signature: string;
}) {
  const expected = Buffer.from(createWebhookSignature(input));
  const actual = Buffer.from(input.signature);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
