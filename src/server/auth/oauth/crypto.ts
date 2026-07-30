import "server-only";

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";

const OAUTH_CIPHERTEXT_VERSION = "v1";

function oauthEncryptionKey(secret: string) {
  if (secret.length < 32) throw new Error("OAUTH_STATE_SECRET_INVALID");
  return createHash("sha256").update(secret, "utf8").digest();
}

export function requireOAuthStateSecret(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const secret = environment.OAUTH_STATE_SECRET?.trim();
  if (!secret || secret.length < 32) throw new Error("OAUTH_STATE_SECRET_MISSING");
  return secret;
}

export function createOAuthRandomValue(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function createPkceVerifier() {
  return createOAuthRandomValue(64);
}

export function createPkceChallenge(verifier: string) {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function hashOAuthEvidence(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function encryptOAuthValue(value: string, secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", oauthEncryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(value, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    OAUTH_CIPHERTEXT_VERSION,
    iv.toString("base64url"),
    tag.toString("base64url"),
    ciphertext.toString("base64url"),
  ].join(".");
}

export function decryptOAuthValue(value: string, secret: string) {
  const [version, encodedIv, encodedTag, encodedCiphertext, extra] = value.split(".");
  if (
    version !== OAUTH_CIPHERTEXT_VERSION
    || !encodedIv
    || !encodedTag
    || !encodedCiphertext
    || extra
  ) {
    throw new Error("OAUTH_CIPHERTEXT_INVALID");
  }

  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      oauthEncryptionKey(secret),
      Buffer.from(encodedIv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(encodedTag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(encodedCiphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch {
    throw new Error("OAUTH_CIPHERTEXT_INVALID");
  }
}
