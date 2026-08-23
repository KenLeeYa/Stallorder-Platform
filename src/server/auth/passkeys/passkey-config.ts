import "server-only";

import { getOAuthAppBaseUrl, isProductionOAuthRuntime } from "@/server/auth/oauth/config";

export type PasskeyRuntimeMode = "LIVE" | "MOCK";

function required(value: string | undefined, code: string) {
  const normalized = value?.trim();
  if (!normalized) throw new Error(code);
  return normalized;
}

export function getPasskeyRuntimeConfig(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const mode: PasskeyRuntimeMode = environment.PASSKEY_PROVIDER_MODE?.trim().toLowerCase() === "mock"
    ? "MOCK"
    : "LIVE";
  if (mode === "MOCK" && isProductionOAuthRuntime(environment)) {
    throw new Error("PASSKEY_MOCK_FORBIDDEN");
  }

  const appUrl = new URL(getOAuthAppBaseUrl(environment));
  const rpId = mode === "MOCK"
    ? appUrl.hostname
    : required(environment.PASSKEY_RP_ID, "PASSKEY_RP_ID_MISSING");
  const origin = mode === "MOCK"
    ? appUrl.origin
    : required(environment.PASSKEY_ALLOWED_ORIGIN, "PASSKEY_ORIGIN_MISSING");

  const localhostMock = mode === "MOCK"
    && (appUrl.hostname === "localhost" || appUrl.hostname === "127.0.0.1")
    && origin.startsWith("http://");
  if (rpId !== appUrl.hostname || origin !== appUrl.origin || (!origin.startsWith("https://") && !localhostMock)) {
    throw new Error("PASSKEY_RP_ORIGIN_MISMATCH");
  }

  return { mode, rpId, origin };
}
