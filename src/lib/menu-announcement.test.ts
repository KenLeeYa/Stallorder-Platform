import { describe, expect, it } from "vitest";
import { activeMenuAnnouncement, menuAnnouncementSchema, type MenuAnnouncementView } from "./menu-announcement";
import { announcementInputToIso } from "@/components/stall-menu-announcement-manager";

const value: MenuAnnouncementView = {
  stallId: "22222222-2222-4222-8222-222222222222", enabled: true, title: "活動", content: "週末活動\n歡迎來店",
  startsAt: "2026-09-11T01:00:00.000Z", endsAt: "2026-09-11T11:00:00.000Z", revision: "11111111-1111-4111-8111-111111111111",
};
describe("menu announcement timing and content", () => {
  it("includes the start, excludes the end, and honours disable", () => {
    expect(activeMenuAnnouncement(value, Date.parse(value.startsAt!) - 1)).toBe(false);
    expect(activeMenuAnnouncement(value, Date.parse(value.startsAt!))).toBe(true);
    expect(activeMenuAnnouncement(value, Date.parse(value.endsAt!))).toBe(false);
    expect(activeMenuAnnouncement({ ...value, enabled: false }, Date.parse(value.startsAt!))).toBe(false);
  });
  it("validates required text, bounds and stale revision syntax", () => {
    const { enabled, title, content, startsAt, endsAt, revision } = value;
    const fields = { enabled, title, content, startsAt, endsAt };
    expect(menuAnnouncementSchema.safeParse({ ...fields, expectedRevision: revision }).success).toBe(true);
    expect(menuAnnouncementSchema.safeParse({ ...fields, expectedRevision: revision, content: " " }).success).toBe(false);
    expect(menuAnnouncementSchema.safeParse({ ...fields, expectedRevision: revision, endsAt: fields.startsAt }).success).toBe(false);
    expect(menuAnnouncementSchema.safeParse({ ...fields, expectedRevision: revision, title: "字".repeat(81) }).success).toBe(false);
  });
  it("uses the stall timezone rather than the operator timezone", () => {
    expect(announcementInputToIso("2026-09-11T18:40", "Asia/Taipei")).toBe("2026-09-11T10:40:00.000Z");
    expect(announcementInputToIso("2026-09-11T18:40", "Asia/Tokyo")).toBe("2026-09-11T09:40:00.000Z");
    expect(announcementInputToIso("", "Asia/Taipei")).toBeNull();
  });
});
