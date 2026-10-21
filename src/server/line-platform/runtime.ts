import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";

const configuration = z.object({
  environment: z.enum(["local", "preview", "production"]),
  providerId: z.string().regex(/^\d{1,30}$/),
  channelId: z.string().regex(/^\d{1,30}$/),
  liffId: z.string().regex(/^\d+-[A-Za-z0-9]+$/),
  internalChannel: z.enum(["developing", "review", "published"]),
  endpointUrl: z.string().url(),
  oaDestination: z.string().regex(/^U[0-9a-f]{32}$/),
  oaChannelId: z.string().regex(/^\d{1,30}$/),
  oaAccessTokenReference: z.string().uuid(),
  oaSecretReference: z.string().uuid(),
  termsVersion: z.string().min(1).max(80),
  addFriendUrl: z.string().url().optional(),
}).strict();

export type LinePlatformRuntime = z.infer<typeof configuration> & {
  notificationsEnabled: boolean; pickupEnabled: boolean; payEnabled: boolean;
};

/** Server configuration only. No tenant can select a platform sender or environment. */
export function getLinePlatformRuntime(env: NodeJS.ProcessEnv = process.env): LinePlatformRuntime | null {
  if (env.LINE_PLATFORM_ENABLED !== "true") return null;
  const parsed = configuration.safeParse(JSON.parse(env.LINE_PLATFORM_BINDING_JSON ?? "{}"));
  if (!parsed.success) throw new Error("LINE_PLATFORM_CONFIGURATION_INVALID");
  const binding = parsed.data;
  const expected = env.VERCEL_ENV === "production" ? "production" : env.VERCEL_ENV === "preview" ? "preview"
    : ["development", "test"].includes(env.NODE_ENV ?? "") || env.APP_ENV === "local" ? "local" : null;
  const endpoint = new URL(binding.endpointUrl);
  if (binding.environment !== expected || env.LINE_PLATFORM_ENVIRONMENT !== expected
    || endpoint.protocol !== "https:" || endpoint.pathname !== "/mini"
    || endpoint.search || endpoint.hash || endpoint.username || endpoint.password
    || ((binding.environment === "production") !== (binding.internalChannel === "published"))) {
    throw new Error("LINE_PLATFORM_ENVIRONMENT_MISMATCH");
  }
  if (binding.environment !== "production" && endpoint.hostname === "app.qidaigo.com") {
    throw new Error("LINE_PLATFORM_PRODUCTION_HOST_REJECTED");
  }
  if (binding.addFriendUrl && !["https://line.me", "https://lin.ee"].includes(new URL(binding.addFriendUrl).origin)) {
    throw new Error("LINE_PLATFORM_FRIEND_LINK_INVALID");
  }
  assertPlatformDatabaseTarget(binding.environment, env);
  return { ...binding, notificationsEnabled: env.LINE_PLATFORM_NOTIFICATIONS_ENABLED === "true",
    pickupEnabled: env.LINE_PLATFORM_PICKUP_ENABLED === "true", payEnabled: env.LINE_PLATFORM_PAY_ENABLED === "true" };
}

export function assertPlatformDatabaseTarget(expected: "local" | "preview" | "production", env: NodeJS.ProcessEnv = process.env) {
  if (expected === "local") return;
  // Compare an independently recorded target to the actual datasource, including pooler username.
  const target = z.object({ environment: z.enum(["preview", "production"]), fingerprint: z.string().regex(/^[0-9a-f]{64}$/) }).strict()
    .safeParse(JSON.parse(env.LINE_PLATFORM_DATABASE_BINDING_JSON ?? "{}"));
  if (!target.success || target.data.environment !== expected || !env.DATABASE_URL
    || target.data.fingerprint !== platformDatabaseFingerprint(env.DATABASE_URL)) throw new Error("LINE_PLATFORM_DATABASE_MISMATCH");
}

export function platformDatabaseFingerprint(value: string) {
  const url = new URL(value);
  if (!["postgres:","postgresql:"].includes(url.protocol)) throw new Error("LINE_PLATFORM_DATABASE_MISMATCH");
  return createHash("sha256").update(JSON.stringify([url.hostname.toLowerCase(),url.port||"5432",url.pathname,url.username])).digest("hex");
}
