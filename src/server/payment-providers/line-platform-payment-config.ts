import "server-only";
import { z } from "zod";
import { PaymentProviderError } from "./types";
import { assertPlatformDatabaseTarget } from "@/server/line-platform/runtime";

export type CredentialSnapshot = {
  credentialReference: string; credentialVersion: string; merchantReference: string; channelId: string;
};
export function paymentRuntime(newPayment = false, env: Record<string, string | undefined> = process.env) {
  if (env.LINE_PLATFORM_ENABLED !== "true") throw new PaymentProviderError("LINE_PLATFORM_DISABLED", 404);
  if (env.VERCEL_ENV === "production" || !["local", "preview"].includes(env.LINE_PLATFORM_ENVIRONMENT ?? "")) {
    throw new PaymentProviderError("LINE_PAY_SANDBOX_ONLY", 503);
  }
  if (env.VERCEL_ENV === "preview" && env.LINE_PLATFORM_ENVIRONMENT !== "preview") {
    throw new PaymentProviderError("LINE_PAY_ENVIRONMENT_MISMATCH", 503);
  }
  try { assertPlatformDatabaseTarget(env.LINE_PLATFORM_ENVIRONMENT as "local"|"preview",env as NodeJS.ProcessEnv); }
  catch { throw new PaymentProviderError("LINE_PLATFORM_DATABASE_MISMATCH",503); }
  if (newPayment && env.LINE_PLATFORM_PAY_ENABLED !== "true") throw new PaymentProviderError("LINE_PAY_NEW_PAYMENTS_DISABLED", 503);
  const origin = env.LINE_PLATFORM_PAY_CALLBACK_ORIGIN ?? "";
  const secret = env.LINE_PLATFORM_PAY_STATE_SECRET ?? "";
  let validOrigin = false;
  try { const url = new URL(origin); validOrigin = url.protocol === "https:" && url.origin === origin && !url.username && !url.password; } catch { /* configuration is rejected below */ }
  if (!validOrigin || secret.length < 32) throw new PaymentProviderError("LINE_PAY_CONFIG_INVALID", 503);
  return { environment: env.LINE_PLATFORM_ENVIRONMENT as "local" | "preview", callbackOrigin: origin, stateSecret: secret };
}

const credentialSchema = z.object({
  channelId: z.string().regex(/^\d+$/), channelSecret: z.string().min(1),
  merchantReference: z.string().min(1), version: z.string().min(1), environment: z.literal("SANDBOX"),
});
export function resolvePaymentCredential(snapshot: Omit<CredentialSnapshot, "channelId"> & { channelId?: string }, env: Record<string, string | undefined> = process.env) {
  const key = /^env:\/\/(LINE_PAY_[A-Z0-9_]+_V\d+)$/.exec(snapshot.credentialReference)?.[1];
  try {
    if (!key) throw new Error();
    const credential = credentialSchema.parse(JSON.parse(env[key] ?? ""));
    if (credential.version !== snapshot.credentialVersion || credential.merchantReference !== snapshot.merchantReference
      || (snapshot.channelId && credential.channelId !== snapshot.channelId)) throw new Error();
    return credential;
  } catch { throw new PaymentProviderError("LINE_PAY_CREDENTIAL_MISMATCH", 503); }
}
