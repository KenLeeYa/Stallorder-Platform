import { describe, expect, it } from "vitest";
import { catalogVersionCommandSchema } from "@/server/catalog-versions/catalog-version-command";

describe("catalog version commands", () => {
  it("accepts a draft request and applies the default menu key", () => {
    const parsed = catalogVersionCommandSchema.parse({
      operation: "CREATE_DRAFT",
      name: "秋季菜單",
    });

    expect(parsed).toMatchObject({
      operation: "CREATE_DRAFT",
      name: "秋季菜單",
      menuKey: "DEFAULT",
      sourceVersionId: null,
    });
  });

  it("requires a timezone-aware timestamp when scheduling publication", () => {
    const parsed = catalogVersionCommandSchema.safeParse({
      operation: "TRANSITION",
      versionId: "11111111-1111-4111-8111-111111111111",
      nextStatus: "SCHEDULED",
    });

    expect(parsed.success).toBe(false);
    if (!parsed.success) {
      expect(parsed.error.issues).toEqual(expect.arrayContaining([
        expect.objectContaining({ path: ["scheduledPublishAt"] }),
      ]));
    }
  });

  it("defers current-state lifecycle validation to the transactional service", () => {
    const parsed = catalogVersionCommandSchema.safeParse({
      operation: "TRANSITION",
      versionId: "11111111-1111-4111-8111-111111111111",
      nextStatus: "ACTIVE",
    });

    expect(parsed.success).toBe(true);
  });
});
