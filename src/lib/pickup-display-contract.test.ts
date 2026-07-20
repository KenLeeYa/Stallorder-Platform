import { describe, expect, it } from "vitest";
import {
  cdsVoiceAvailable,
  collectUnannouncedReadyOrders,
  pickupCodeForDisplay,
  pickupDisplaySettingsSchema,
  pickupVoiceMessage,
  type PickupDisplayOrder,
} from "@/lib/pickup-display-contract";

const readyOrder: PickupDisplayOrder = {
  orderNo: "A025",
  pickupCode: "738",
  customerName: null,
  status: "READY",
  readyAt: "2026-07-20T12:30:00.000Z",
};

describe("CDS pickup display contract", () => {
  it("masks pickup codes without exposing the full value", () => {
    expect(pickupCodeForDisplay("738", true, true)).toBe("••8");
    expect(pickupCodeForDisplay("738", true, false)).toBe("738");
    expect(pickupCodeForDisplay("738", false, false)).toBeNull();
  });

  it("does not announce the same ready state twice after a reload", () => {
    const first = collectUnannouncedReadyOrders([readyOrder], []);
    expect(first.unannounced).toEqual([readyOrder]);
    const reloaded = collectUnannouncedReadyOrders([readyOrder], first.nextKeys);
    expect(reloaded.unannounced).toEqual([]);
    expect(reloaded.nextKeys).toEqual(first.nextKeys);
  });

  it("announces only public pickup information", () => {
    expect(pickupVoiceMessage(readyOrder)).toBe(
      "A025 號餐點已完成，請憑取餐碼 738 至櫃台取餐。",
    );
  });

  it("accepts safe appearance values and rejects unsafe URLs", () => {
    const base = {
      showCustomerName: false,
      showPickupCode: true,
      maskPickupCode: false,
      readyRetentionMinutes: 30,
      preparingRetentionMinutes: 180,
      enableVoice: false,
      voiceLocale: "zh-TW",
      announcementText: "請留意取餐號碼",
      isActive: true,
    };
    expect(pickupDisplaySettingsSchema.safeParse({
      ...base,
      theme: { logoUrl: "https://assets.example.test/logo.png", backgroundImageUrl: "/display.jpg", accentColor: "#0f766e" },
    }).success).toBe(true);
    expect(pickupDisplaySettingsSchema.safeParse({
      ...base,
      theme: { logoUrl: "javascript:alert(1)", backgroundImageUrl: "", accentColor: "#0f766e" },
    }).success).toBe(false);
  });

  it("enforces voice announcements from server-side entitlement configuration", () => {
    expect(cdsVoiceAvailable({ voiceAnnouncements: true })).toBe(true);
    expect(cdsVoiceAvailable({ voiceAnnouncements: false })).toBe(false);
    expect(cdsVoiceAvailable(null)).toBe(false);
  });
});
