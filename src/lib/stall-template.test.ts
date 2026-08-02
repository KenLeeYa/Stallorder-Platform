import { describe, expect, it } from "vitest";
import { applyStallTemplateSchema, stallTemplateSections } from "./stall-template";

describe("stall template ordering experience", () => {
  it("accepts the linked staff delivery, preorder, and lottery section", () => {
    expect(stallTemplateSections).toContain("ORDERING_EXPERIENCE");
    expect(applyStallTemplateSchema.safeParse({
      sourceStallId: "11111111-1111-4111-8111-111111111111",
      sections: ["ORDERING_EXPERIENCE"],
    }).success).toBe(true);
  });

  it("still rejects duplicate template sections", () => {
    expect(applyStallTemplateSchema.safeParse({
      sourceStallId: "11111111-1111-4111-8111-111111111111",
      sections: ["ORDERING_EXPERIENCE", "ORDERING_EXPERIENCE"],
    }).success).toBe(false);
  });
});
