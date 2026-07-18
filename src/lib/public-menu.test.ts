import { beforeEach, describe, expect, it, vi } from "vitest";

const revalidateTag = vi.fn();
const findMany = vi.fn();

vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({
  revalidateTag,
  unstable_cache: (operation: () => unknown) => operation,
}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    stall: { findMany },
  },
}));

describe("public menu invalidation", () => {
  beforeEach(() => {
    revalidateTag.mockReset();
    findMany.mockReset();
  });

  it("deduplicates stall menu invalidation tags", async () => {
    const { invalidatePublicMenus } = await import("./public-menu");

    invalidatePublicMenus(["stall-a", "stall-a", "stall-b"]);

    expect(revalidateTag).toHaveBeenCalledTimes(2);
    expect(revalidateTag).toHaveBeenCalledWith("stall-menu:stall-a", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("stall-menu:stall-b", { expire: 0 });
  });

  it("invalidates every stall belonging to an organization", async () => {
    findMany.mockResolvedValue([{ id: "stall-a" }, { id: "stall-b" }]);
    const { invalidateOrganizationPublicMenus } = await import("./public-menu");

    await invalidateOrganizationPublicMenus("organization-id");

    expect(findMany).toHaveBeenCalledWith({
      where: { organizationId: "organization-id" },
      select: { id: true },
    });
    expect(revalidateTag).toHaveBeenCalledWith("stall-menu:stall-a", { expire: 0 });
    expect(revalidateTag).toHaveBeenCalledWith("stall-menu:stall-b", { expire: 0 });
  });

  it("invalidates QR context without exposing the raw token", async () => {
    const { invalidatePublicQrToken } = await import("./public-menu");
    const token = "printed-secret-token";

    invalidatePublicQrToken(token);

    const [tag] = revalidateTag.mock.calls[0];
    expect(tag).toMatch(/^public-qr:[a-f0-9]{64}$/);
    expect(tag).not.toContain(token);
  });
});
