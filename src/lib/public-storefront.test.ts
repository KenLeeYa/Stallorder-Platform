import { describe, expect, it, vi } from "vitest";
import {
  buildPublicStorefrontPath,
  normalizePublicStorefrontIdentifier,
  resolveLegacyPublicStorefrontSlugIdentifier,
  resolvePublicStorefront,
  resolvePublicStorefrontIdentifier,
  resolvePublicStorefrontView,
  selectPublicStorefrontQrToken,
} from "./public-storefront";

const prismaMocks = vi.hoisted(() => ({
  stallFindMany: vi.fn(),
  stallFindUnique: vi.fn(),
}));

vi.mock("@/lib/prisma", () => ({
  prisma: {
    stall: {
      findMany: prismaMocks.stallFindMany,
      findUnique: prismaMocks.stallFindUnique,
    },
  },
}));

type Candidate = {
  id: string;
  code: string;
  slug: string;
  isActive: boolean;
  organization: { status: string };
};

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    id: "stall-1",
    code: "VIET-FOOD-YC",
    slug: "a-hong-he-fen",
    isActive: true,
    organization: { status: "ACTIVE" },
    ...overrides,
  };
}

describe("public storefront identifier", () => {
  it.each([
    [" VIET-FOOD-YC ", "viet-food-yc"],
    ["a-hong-he-fen", "a-hong-he-fen"],
    ["A1", "a1"],
  ])("normalizes %s", (input, expected) => {
    expect(normalizePublicStorefrontIdentifier(input)).toBe(expected);
  });

  it.each(["a", "has/slash", "has space", "中文代碼", "a".repeat(51)])(
    "rejects malformed identifiers: %s",
    (input) => expect(normalizePublicStorefrontIdentifier(input)).toBeNull(),
  );

  it("resolves only the canonical code", async () => {
    const result = await resolvePublicStorefrontIdentifier("VIET-FOOD-YC", {
      findByCanonicalCode: vi.fn().mockResolvedValue([candidate()]),
    });

    expect(result).toMatchObject({
      canonicalIdentifier: "viet-food-yc",
      matchedBy: "canonical-code",
      stall: { id: "stall-1" },
    });
  });

  it("queries only true generic QR codes for a shared storefront", async () => {
    prismaMocks.stallFindMany.mockResolvedValueOnce([candidate()]);

    await resolvePublicStorefront("viet-food-yc");

    expect(prismaMocks.stallFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { code: { equals: "viet-food-yc", mode: "insensitive" } },
      select: expect.objectContaining({
        qrCodes: expect.objectContaining({
          where: expect.objectContaining({
            diningTableId: null,
            marketEventId: null,
            stallScheduleId: null,
            locationId: null,
          }),
        }),
      }),
      take: 2,
    }));
  });

  it("fails closed instead of falling back to a colliding legacy slug", async () => {
    const result = await resolvePublicStorefrontIdentifier("a-hong-he-fen", {
      findByCanonicalCode: vi.fn().mockResolvedValue([]),
    });

    expect(result).toBeNull();
  });

  it("fails closed when more than one case-insensitive code match exists", async () => {
    const result = await resolvePublicStorefrontIdentifier("viet-food-yc", {
      findByCanonicalCode: vi.fn().mockResolvedValue([
        candidate(),
        candidate({ id: "stall-2", code: "viet-food-yc", slug: "other-stall" }),
      ]),
    });

    expect(result).toBeNull();
  });

  it("keeps code and slug namespaces independent when their identifiers collide", async () => {
    const codeStall = candidate({ id: "code-stall", code: "SHARED-NAME", slug: "other-stall" });
    const slugStall = candidate({ id: "slug-stall", code: "SLUG-STALL-CODE", slug: "shared-name" });
    const findByLegacySlug = vi.fn().mockResolvedValue(slugStall);

    const codeResult = await resolvePublicStorefrontIdentifier("shared-name", {
      findByCanonicalCode: vi.fn().mockResolvedValue([codeStall]),
    });
    const slugResult = await resolveLegacyPublicStorefrontSlugIdentifier("shared-name", {
      findByLegacySlug,
    });

    expect(findByLegacySlug).toHaveBeenCalledWith("shared-name");
    expect(codeResult).toMatchObject({
      canonicalIdentifier: "shared-name",
      matchedBy: "canonical-code",
      stall: { id: "code-stall" },
    });
    expect(slugResult).toMatchObject({
      canonicalIdentifier: "slug-stall-code",
      matchedBy: "legacy-slug",
      stall: { id: "slug-stall" },
    });
  });

  it("does not case-fold or trim a legacy slug", async () => {
    const findByLegacySlug = vi.fn();

    await expect(resolveLegacyPublicStorefrontSlugIdentifier("Shared-Name", {
      findByLegacySlug,
    })).resolves.toBeNull();
    await expect(resolveLegacyPublicStorefrontSlugIdentifier(" shared-name ", {
      findByLegacySlug,
    })).resolves.toBeNull();
    expect(findByLegacySlug).not.toHaveBeenCalled();
  });
});

describe("public storefront navigation", () => {
  it("only accepts the three supported storefront modes", () => {
    expect(resolvePublicStorefrontView("pickup")).toBe("pickup");
    expect(resolvePublicStorefrontView(["delivery", "menu"])).toBe("delivery");
    expect(resolvePublicStorefrontView("unknown")).toBe("menu");
  });

  it("preserves benign query values while keeping a fixed internal destination", () => {
    expect(buildPublicStorefrontPath("viet-food-yc", "delivery", {
      locale: "vi",
      utm_source: "line",
      next: "https://attacker.example",
      view: "pickup",
    })).toBe("/store/viet-food-yc?locale=vi&utm_source=line&view=delivery");
  });

  it("selects only a live generic QR compatible with the requested mode", () => {
    const now = Date.parse("2026-08-13T00:00:00Z");
    const qrCodes = [
      { token: "expired", fulfillmentTypeContext: null, expiresAt: new Date(now - 1) },
      { token: "delivery", fulfillmentTypeContext: "DELIVERY", expiresAt: null },
      { token: "takeout", fulfillmentTypeContext: "TAKEOUT", expiresAt: null },
    ];

    expect(selectPublicStorefrontQrToken(qrCodes, "pickup", now)).toBe("takeout");
    expect(selectPublicStorefrontQrToken(qrCodes, "delivery", now)).toBe("delivery");
    expect(selectPublicStorefrontQrToken([], "pickup", now)).toBeNull();
  });
});
