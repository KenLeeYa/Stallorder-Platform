import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const deviceIdPattern = /^PRN_[A-Za-z0-9_-]{16}$/u;
const deviceTokenPattern = /^cpt_v1_[A-Za-z0-9_-]{43}$/u;

export type CloudPrntCredential = {
  deviceId: string;
  deviceToken: string;
  deviceTokenHash: string;
};

export function createCloudPrntCredential(): CloudPrntCredential {
  return rotateCloudPrntCredential(`PRN_${randomBytes(12).toString("base64url")}`);
}

export function rotateCloudPrntCredential(deviceId: string): CloudPrntCredential {
  if (!isCloudPrntDeviceId(deviceId)) throw new Error("CLOUDPRNT_DEVICE_ID_INVALID");
  const deviceToken = `cpt_v1_${randomBytes(32).toString("base64url")}`;
  return {
    deviceId,
    deviceToken,
    deviceTokenHash: cloudPrntTokenHash(deviceToken),
  };
}

export function cloudPrntTokenHash(deviceToken: string) {
  return createHash("sha256").update(deviceToken, "utf8").digest("hex");
}

export function isCloudPrntDeviceId(value: string) {
  return deviceIdPattern.test(value);
}

export function verifyCloudPrntRequest(
  request: Request,
  expectedDeviceId: string,
  expectedTokenHash: string,
) {
  const supplied = cloudPrntBasicCredential(request);
  if (!supplied || !safeEqual(supplied.deviceId, expectedDeviceId)) return false;
  return safeEqual(cloudPrntTokenHash(supplied.deviceToken), expectedTokenHash);
}

export function cloudPrntServerUrl(
  deviceId: string,
  environment: NodeJS.ProcessEnv = process.env,
) {
  if (!isCloudPrntDeviceId(deviceId)) throw new Error("CLOUDPRNT_DEVICE_ID_INVALID");
  const previewUrl = environment.VERCEL_ENV === "preview" && environment.VERCEL_URL
    ? `https://${environment.VERCEL_URL}`
    : undefined;
  const configured = previewUrl
    ?? environment.APP_BASE_URL?.trim()
    ?? environment.NEXT_PUBLIC_APP_URL?.trim();
  if (!configured) throw new Error("CLOUDPRNT_APP_URL_MISSING");

  const base = new URL(configured);
  const localHttp = environment.NODE_ENV !== "production"
    && base.protocol === "http:"
    && ["localhost", "127.0.0.1", "::1"].includes(base.hostname);
  if (base.protocol !== "https:" && !localHttp) {
    throw new Error("CLOUDPRNT_APP_URL_HTTPS_REQUIRED");
  }
  return `${base.origin}/api/cloudprnt/v1/${encodeURIComponent(deviceId)}`;
}

function cloudPrntBasicCredential(request: Request) {
  const authorization = request.headers.get("authorization")?.trim();
  const basic = authorization ? /^Basic\s+([A-Za-z0-9+/=]+)$/iu.exec(authorization) : null;
  if (!basic) return null;

  let decoded = "";
  try {
    decoded = Buffer.from(basic[1] ?? "", "base64").toString("utf8");
  } catch {
    return null;
  }
  const separator = decoded.indexOf(":");
  if (separator < 0) return null;
  const deviceId = decoded.slice(0, separator);
  const deviceToken = decoded.slice(separator + 1);
  return isCloudPrntDeviceId(deviceId) && deviceTokenPattern.test(deviceToken)
    ? { deviceId, deviceToken }
    : null;
}

function safeEqual(left: string, right: string) {
  const leftBytes = Buffer.from(left, "utf8");
  const rightBytes = Buffer.from(right, "utf8");
  return leftBytes.length === rightBytes.length && timingSafeEqual(leftBytes, rightBytes);
}
