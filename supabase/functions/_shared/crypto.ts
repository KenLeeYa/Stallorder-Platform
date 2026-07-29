const encoder = new TextEncoder();

function toHex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function hmacBytes(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(value)));
}

export async function sha256Hex(value: string) {
  return toHex(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function sha256Base64Url(value: string) {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value))));
}

export async function hmacHex(secret: string, value: string) {
  return toHex(await hmacBytes(secret, value));
}

export function randomToken(bytes = 32) {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(bytes)));
}

export async function derivePublicOrderTokens(orderId: string, secret: string, pickupCodeLength: 3 | 6 = 3) {
  const trackingBytes = await hmacBytes(secret, `tracking:${orderId}`);
  const pickupBytes = await hmacBytes(secret, `pickup:${orderId}`);
  const pickupNumber = (
    ((pickupBytes[0] << 24) | (pickupBytes[1] << 16) | (pickupBytes[2] << 8) | pickupBytes[3]) >>> 0
  ) % (pickupCodeLength === 3 ? 1_000 : 1_000_000);

  return {
    trackingToken: `sto_${toBase64Url(trackingBytes)}`,
    pickupCode: pickupNumber.toString().padStart(pickupCodeLength, "0"),
  };
}

export async function deriveOrderSessionToken(
  sessionRequestId: string,
  qrToken: string,
  deviceId: string,
  secret: string,
) {
  const bytes = await hmacBytes(
    secret,
    `session:${sessionRequestId}:${qrToken}:${deviceId}`,
  );
  return `stos_${toBase64Url(bytes)}`;
}
