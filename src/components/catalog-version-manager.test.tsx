import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CatalogVersionManager } from "@/components/catalog-version-manager";

describe("CatalogVersionManager", () => {
  it("explains the safe local pilot boundary and renders mobile-friendly actions", () => {
    const html = renderToStaticMarkup(
      <CatalogVersionManager
        organizationId="11111111-1111-4111-8111-111111111111"
        initialVersions={[{
          id: "22222222-2222-4222-8222-222222222222",
          menuKey: "DEFAULT",
          name: "秋季菜單",
          versionNumber: 2,
          status: "DRAFT",
          currency: "TWD",
          sourceVersionId: null,
          scheduledPublishAt: null,
          publishedAt: null,
          checksum: "abc123",
          itemCount: 12,
          publicationCount: 0,
          createdAt: "2026-08-26T00:00:00.000Z",
          updatedAt: "2026-08-26T00:00:00.000Z",
        }]}
      />,
    );

    expect(html).toContain("本機試用範圍");
    expect(html).toContain("不會直接改動現行 QR 與店員點餐菜單");
    expect(html).toContain("秋季菜單");
    expect(html).toContain("送審");
    expect(html).toContain("min-h-11");
  });
});
