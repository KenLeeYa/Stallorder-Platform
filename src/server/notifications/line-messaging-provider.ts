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
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) {
      throw new NotificationProviderError(
        `LINE_HTTP_${response.status}`,
        response.status === 408 || response.status === 429 || response.status >= 500,
      );
    }
    return { providerMessageId: response.headers.get("x-line-request-id") };
  }
}
