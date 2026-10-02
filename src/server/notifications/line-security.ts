import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

import { BoundedTextReadError } from "@/server/delivery-platforms/bounded-text-reader";

export function verifyLineWebhookSignature(rawBody: string | Uint8Array, signature: string | null, channelSecret: string) {
  if (!signature || !channelSecret) return false;
  const expected = createHmac("sha256", channelSecret).update(rawBody).digest("base64");
  const actualBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}
export function createLinePkce() {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export function buildLineAuthorizationUrl(input: {
  channelId: string;
  redirectUri: string;
  state: string;
  nonce: string;
  codeChallenge: string;
}) {
  const url = new URL("https://access.line.me/oauth2/v2.1/authorize");
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", input.channelId);
  url.searchParams.set("redirect_uri", input.redirectUri);
  url.searchParams.set("state", input.state);
  url.searchParams.set("scope", "openid profile");
  url.searchParams.set("nonce", input.nonce);
  url.searchParams.set("code_challenge", input.codeChallenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("bot_prompt", "aggressive");
  return url.toString();
}

/** Preserve exact bytes until HMAC verification; decoding before verification changes the signed input. */
export async function readLineWebhookBytes(request: Request, maxBytes = 64_000) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared)))) {
    throw new BoundedTextReadError("INVALID_CONTENT_LENGTH");
  }
  if (declared !== null && Number(declared) > maxBytes) throw new BoundedTextReadError("BODY_TOO_LARGE");
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new BoundedTextReadError("READ_TIMEOUT")), 10_000);
  });
  try {
    while (true) {
      const part = await Promise.race([reader.read(), deadline]);
      if (part.done) return Buffer.concat(chunks, length);
      length += part.value.byteLength;
      if (length > maxBytes) throw new BoundedTextReadError("BODY_TOO_LARGE");
      chunks.push(part.value);
    }
  } catch (error) {
    // A malicious stream must not hold cleanup open after the bounded read has failed.
    void reader.cancel().catch(() => undefined);
    if (error instanceof BoundedTextReadError) throw error;
    throw new BoundedTextReadError("READ_FAILED");
  } finally {
    if (timer) clearTimeout(timer);
    reader.releaseLock();
  }
}
