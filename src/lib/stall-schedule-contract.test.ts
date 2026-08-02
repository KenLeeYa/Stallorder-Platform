import { describe, expect, it } from "vitest";
import {
  marketEventCommandSchema,
  normalizeAutomaticOrderingFlags,
  stallLocationCommandSchema,
  stallScheduleCommandSchema,
} from "@/lib/stall-schedule-contract";

const locationId = "11111111-1111-4111-8111-111111111111";
const scheduleId = "22222222-2222-4222-8222-222222222222";

describe("stall schedule contracts", () => {
  it("requires coordinate pairs and HTTPS map URLs", () => {
    expect(stallLocationCommandSchema.safeParse({
      operation: "CREATE",
      name: "寧夏夜市入口",
      address: "台北市大同區寧夏路",
      latitude: 25.056,
      longitude: null,
      mapUrl: "http://example.test/map",
      instructions: null,
      isActive: true,
    }).success).toBe(false);
  });

  it("rejects an event whose end is before its start", () => {
    expect(marketEventCommandSchema.safeParse({
      operation: "CREATE",
      name: "週末市集",
      slug: "weekend-market",
      description: null,
      venueName: "市民廣場",
      address: "台北市信義區",
      latitude: null,
      longitude: null,
      startsAt: "2026-08-02T10:00:00+08:00",
      endsAt: "2026-08-02T09:00:00+08:00",
      organizer: null,
      publicUrl: null,
      isPublic: true,
    }).success).toBe(false);
  });

  it("requires a location or market event for every schedule", () => {
    expect(stallScheduleCommandSchema.safeParse({
      operation: "CREATE",
      locationId: null,
      marketEventId: null,
      startsAt: "2026-08-02T17:00:00+08:00",
      endsAt: "2026-08-02T23:00:00+08:00",
      orderingOpensAt: null,
      orderingClosesAt: null,
      specialNotice: null,
      menuOverrideId: null,
      autoOpenEnabled: false,
      autoCloseEnabled: false,
    }).success).toBe(false);
  });

  it("accepts a bounded weekly copy and strict QR context command", () => {
    expect(stallScheduleCommandSchema.safeParse({
      operation: "COPY_WEEKLY",
      scheduleId,
      weeks: 4,
      reason: "建立未來四週固定行程",
    }).success).toBe(true);
    expect(stallScheduleCommandSchema.safeParse({
      operation: "ASSIGN_QR_CONTEXT",
      qrCodeId: locationId,
      scheduleId,
      fulfillmentType: "TAKEOUT",
      reason: "綁定本週市集 QR",
      organizationId: locationId,
    }).success).toBe(false);
  });

  it("clears stale automatic ordering flags when the plan capability is removed", () => {
    expect(normalizeAutomaticOrderingFlags(false, {
      autoOpenEnabled: true,
      autoCloseEnabled: true,
    })).toEqual({
      autoOpenEnabled: false,
      autoCloseEnabled: false,
    });
    expect(normalizeAutomaticOrderingFlags(true, {
      autoOpenEnabled: true,
      autoCloseEnabled: false,
    })).toEqual({
      autoOpenEnabled: true,
      autoCloseEnabled: false,
    });
  });
});
