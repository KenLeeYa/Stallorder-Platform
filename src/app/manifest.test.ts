import { describe, expect, it, vi } from "vitest";
import manifest from "@/app/manifest";

vi.mock("@/lib/app-locale-server", () => ({
  getRequestAppLocale: async () => ({ locale: "vi", hasLocaleCookie: true }),
}));

describe("PWA manifest launch contract", () => {
  it("opens the session-aware launch route with request-localized metadata", async () => {
    const result = await manifest();

    expect(result.start_url).toBe("/launch");
    expect(result.lang).toBe("vi");
    expect(result.description).toContain("Đặt món QR");
  });
});
