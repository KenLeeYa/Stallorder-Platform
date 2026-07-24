import { describe, expect, it } from "vitest";
import {
  lineIntegrationCommandSchema,
  lineIntegrationSecretsSchema,
  lineWebhookBodySchema,
} from "./line-notification-contract";

describe("LINE notification contracts", () => {
  it("accepts a complete integration configuration", () => {
    expect(lineIntegrationCommandSchema.safeParse({
      operation: "UPSERT",
      channelId: "1234567890",
      channelAccessToken: "access-token-at-least-sixteen",
      messagingChannelSecret: "messaging-secret-at-least-sixteen",
      loginChannelSecret: "login-secret-at-least-sixteen",
      displayName: "阿明雞排 LINE",
      officialAccountUrl: "https://lin.ee/example",
      notifyConfirmed: true,
      notifyReady: true,
      notifyCancelled: true,
    }).success).toBe(true);
  });

  it("does not permit extra or missing secret fields", () => {
    expect(lineIntegrationSecretsSchema.safeParse({
      channelAccessToken: "access-token-at-least-sixteen",
      messagingChannelSecret: "messaging-secret-at-least-sixteen",
      loginChannelSecret: "login-secret-at-least-sixteen",
      rawUserId: "must-not-be-stored-here",
    }).success).toBe(false);
  });

  it("bounds LINE webhook event count", () => {
    const event = { type: "follow", timestamp: Date.now(), source: { type: "user", userId: "U123" } };
    expect(lineWebhookBodySchema.safeParse({ destination: "Ubot", events: [event] }).success).toBe(true);
    expect(lineWebhookBodySchema.safeParse({ destination: "Ubot", events: Array(101).fill(event) }).success).toBe(false);
  });
});
