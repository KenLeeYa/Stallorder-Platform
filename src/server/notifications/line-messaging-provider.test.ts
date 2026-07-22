import { describe, expect, it, vi } from "vitest";
import { LineMessagingProvider } from "./line-messaging-provider";
import { NotificationProviderError } from "./notification-provider";

describe("LineMessagingProvider", () => {
  it("sends a push message with a retry key", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(new Response(null, {
      status: 200,
      headers: { "x-line-request-id": "request-id" },
    }));
    const provider = new LineMessagingProvider("channel-access-token", fetchImpl);
    await expect(provider.send({
      jobId: "00000000-0000-4000-8000-000000000001",
      recipient: "Urecipient",
      text: "訂單已完成",
    })).resolves.toEqual({ providerMessageId: "request-id" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://api.line.me/v2/bot/message/push",
      expect.objectContaining({ method: "POST", cache: "no-store" }),
    );
  });

  it("classifies rate limits as retryable and invalid credentials as permanent", async () => {
    const rateLimited = new LineMessagingProvider("token", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 429 })));
    await expect(rateLimited.send({ jobId: crypto.randomUUID(), recipient: "U1", text: "test" }))
      .rejects.toMatchObject({ code: "LINE_HTTP_429", retryable: true } satisfies Partial<NotificationProviderError>);

    const unauthorized = new LineMessagingProvider("token", vi.fn<typeof fetch>().mockResolvedValue(new Response(null, { status: 401 })));
    await expect(unauthorized.send({ jobId: crypto.randomUUID(), recipient: "U1", text: "test" }))
      .rejects.toMatchObject({ code: "LINE_HTTP_401", retryable: false } satisfies Partial<NotificationProviderError>);
  });
});
