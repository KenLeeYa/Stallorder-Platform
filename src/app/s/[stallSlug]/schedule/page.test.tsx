import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveStorefront: vi.fn(),
  resolveLegacySlug: vi.fn(),
  getSchedule: vi.fn(),
  notFound: vi.fn(() => { throw new Error("NOT_FOUND"); }),
  redirect: vi.fn(() => { throw new Error("REDIRECT"); }),
}));

vi.mock("@/lib/app-locale-server", () => ({
  getRequestAppLocale: () => Promise.resolve({ locale: "zh-TW", hasLocaleCookie: false }),
}));
vi.mock("@/lib/public-storefront", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/public-storefront")>(),
  resolvePublicStorefront: mocks.resolveStorefront,
  resolveLegacyPublicStorefrontSlug: mocks.resolveLegacySlug,
}));
vi.mock("@/lib/stall-schedules", () => ({
  getPublicStallSchedule: mocks.getSchedule,
}));
vi.mock("next/navigation", () => ({
  notFound: mocks.notFound,
  redirect: mocks.redirect,
}));

import PublicStallSchedulePage from "./page";

const canonicalResolution = {
  canonicalIdentifier: "viet-food-yc",
  matchedBy: "canonical-code",
  stall: { slug: "a-hong-he-fen" },
};

describe("public stall schedule canonical identifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveStorefront.mockResolvedValue(canonicalResolution);
    mocks.resolveLegacySlug.mockResolvedValue(null);
    mocks.getSchedule.mockResolvedValue({
      stall: {
        name: "越好吃一中店",
        slug: "a-hong-he-fen",
        timezone: "Asia/Taipei",
      },
      generatedAt: "2026-08-13T12:00:00.000Z",
      schedules: [],
    });
  });

  it("queries schedules by the internal slug and links back to the code-based unified pickup page", async () => {
    const element = await PublicStallSchedulePage({
      params: Promise.resolve({ stallSlug: "viet-food-yc" }),
      searchParams: Promise.resolve({ locale: "vi" }),
    });
    const html = renderToStaticMarkup(element);

    expect(mocks.resolveStorefront).toHaveBeenCalledWith("viet-food-yc");
    expect(mocks.resolveLegacySlug).not.toHaveBeenCalled();
    expect(mocks.getSchedule).toHaveBeenCalledWith("a-hong-he-fen");
    expect(html).toContain('href="/store/viet-food-yc?locale=vi&amp;view=pickup"');
    expect(html).not.toContain('href="/s/a-hong-he-fen"');
  });

  it("redirects a differently cased code to the exact canonical schedule path", async () => {
    await expect(PublicStallSchedulePage({
      params: Promise.resolve({ stallSlug: "VIET-FOOD-YC" }),
      searchParams: Promise.resolve({ locale: "vi" }),
    })).rejects.toThrow("REDIRECT");

    expect(mocks.resolveStorefront).toHaveBeenCalledWith("viet-food-yc");
    expect(mocks.redirect).toHaveBeenCalledWith("/s/viet-food-yc/schedule?locale=vi");
    expect(mocks.getSchedule).not.toHaveBeenCalled();
  });

  it("redirects a legacy slug in any case to the canonical code without adding an implicit locale", async () => {
    mocks.resolveStorefront.mockResolvedValue(null);
    mocks.resolveLegacySlug.mockResolvedValue({
      ...canonicalResolution,
      matchedBy: "legacy-slug",
    });

    await expect(PublicStallSchedulePage({
      params: Promise.resolve({ stallSlug: "A-HONG-HE-FEN" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("REDIRECT");

    expect(mocks.resolveLegacySlug).toHaveBeenCalledWith("a-hong-he-fen");
    expect(mocks.redirect).toHaveBeenCalledWith("/s/viet-food-yc/schedule");
    expect(mocks.getSchedule).not.toHaveBeenCalled();
  });

  it("returns not found for an unknown identifier", async () => {
    mocks.resolveStorefront.mockResolvedValue(null);
    mocks.resolveLegacySlug.mockResolvedValue(null);

    await expect(PublicStallSchedulePage({
      params: Promise.resolve({ stallSlug: "missing" }),
      searchParams: Promise.resolve({}),
    })).rejects.toThrow("NOT_FOUND");
  });
});
