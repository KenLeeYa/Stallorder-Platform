import { describe, expect, it } from "vitest";
import {
  assertEventCampaignTransition,
  eventGrowthCommandSchema,
} from "@/server/event-growth/event-growth-contract";

const eventId = "11111111-1111-4111-8111-111111111111";

describe("event growth commands", () => {
  it("normalizes campaign dimensions", () => {
    const parsed = eventGrowthCommandSchema.parse({
      operation: "CREATE_CAMPAIGN",
      marketEventId: eventId,
      name: "夏日市集 LINE",
      source: " line ",
      medium: " qr ",
      campaignCode: " summer-2026 ",
      startsAt: "2026-09-01T00:00:00.000+08:00",
      endsAt: "2026-09-03T23:59:59.000+08:00",
    });

    expect(parsed.operation).toBe("CREATE_CAMPAIGN");
    if (parsed.operation !== "CREATE_CAMPAIGN") throw new Error("unexpected command");
    expect(parsed).toMatchObject({ source: "LINE", medium: "QR", campaignCode: "SUMMER-2026" });
  });

  it("rejects a negative event expense", () => {
    expect(eventGrowthCommandSchema.safeParse({
      operation: "CREATE_EXPENSE",
      marketEventId: eventId,
      category: "BOOTH_FEE",
      amount: -1,
      note: "場租",
      incurredAt: "2026-09-01T00:00:00.000+08:00",
    }).success).toBe(false);
  });

  it("allows only forward campaign lifecycle transitions", () => {
    expect(() => assertEventCampaignTransition("DRAFT", "ACTIVE")).not.toThrow();
    expect(() => assertEventCampaignTransition("ACTIVE", "PAUSED")).not.toThrow();
    expect(() => assertEventCampaignTransition("PAUSED", "ACTIVE")).not.toThrow();
    expect(() => assertEventCampaignTransition("ACTIVE", "ENDED")).not.toThrow();
    expect(() => assertEventCampaignTransition("ENDED", "ACTIVE")).toThrow("EVENT_CAMPAIGN_TRANSITION_INVALID");
  });
});
