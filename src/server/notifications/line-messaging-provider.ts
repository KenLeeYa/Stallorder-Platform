import type {
  NotificationMessage,
  NotificationProviderAdapter,
  NotificationSendResult,
} from "./notification-provider";
import { NotificationProviderError } from "./notification-provider";

export class LineMessagingProvider implements NotificationProviderAdapter {
  constructor(
    private readonly channelAccessToken: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async send(message: NotificationMessage): Promise<NotificationSendResult> {
    const response = await this.fetchImpl("https://api.line.me/v2/bot/message/push", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.channelAccessToken}`,
        "content-type": "application/json",
        "x-line-retry-key": message.jobId,
      },
      body: JSON.stringify({
        to: message.recipient,
        messages: [{ type: "text", text: message.text }],
      }),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new NotificationProviderError(
        `LINE_HTTP_${response.status}`,
        response.status === 429,
        response.status === 408 || response.status === 409 || response.status >= 500 ? "UNKNOWN" : "REJECTED",
      );
    }
    return { providerMessageId: response.headers.get("x-line-request-id") };
  }
}

/** Legacy delivery remains disabled outside the explicitly isolated local Mock. */
export function getLegacyLineMockTransport(env: NodeJS.ProcessEnv = process.env): typeof fetch | null {
  if (env.LINE_LEGACY_LOCAL_MOCK !== "true") return null;
  if (env.APP_ENV !== "local" || env.RESPONSIVE_QA_RUN !== "true" || env.VERCEL_ENV || env.VERCEL) {
    throw new Error("LEGACY_MOCK_ENVIRONMENT_DENIED");
  }
  for (const name of ["DATABASE_URL", "DIRECT_URL", "DR_DATABASE_URL", "DR_DIRECT_URL"]) {
    if (!env[name]) {
      if (name === "DATABASE_URL") throw new Error("LEGACY_MOCK_DATABASE_REQUIRED");
      continue;
    }
    const database = new URL(env[name]!);
    if (!["postgres:", "postgresql:"].includes(database.protocol) || !["127.0.0.1", "localhost"].includes(database.hostname)
      || database.port !== "56822" || database.pathname !== "/postgres") throw new Error("LEGACY_MOCK_DATABASE_DENIED");
  }
  const origin = new URL(env.LINE_LEGACY_MOCK_ORIGIN ?? "");
  if (origin.protocol !== "http:" || origin.hostname !== "127.0.0.1" || !origin.port
    || origin.username || origin.password || origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("LEGACY_MOCK_ORIGIN_DENIED");
  }
  return async (input, init) => {
    const target = new URL(String(input));
    if (target.origin !== "https://api.line.me" || target.username || target.password || target.search || target.hash
      || !["/v2/bot/message/push", "/v2/bot/channel/webhook/endpoint", "/v2/bot/channel/webhook/test"].includes(target.pathname)) {
      throw new Error("LEGACY_PROVIDER_TARGET_DENIED");
    }
    return fetch(new URL(target.pathname, origin), { ...init, redirect: "error" });
  };
}
