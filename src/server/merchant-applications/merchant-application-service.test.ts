import { describe, expect, it, vi } from "vitest";
import { findDuplicateRiskReasons } from "./merchant-application-service";

describe("merchant application public identifier risk", () => {
  it("flags a code collision across organizations as a duplicate public identifier", async () => {
    const merchantApplicationCount = vi.fn().mockResolvedValue(0);
    const stallCount = vi.fn().mockImplementation(async ({ where }) => (
      "code" in where ? 1 : 0
    ));

    const reasons = await findDuplicateRiskReasons({
      merchantApplication: { count: merchantApplicationCount },
      stall: { count: stallCount },
    } as never, {
      applicationId: "application-1",
      profileId: "profile-1",
      email: "applicant@example.test",
      phoneHash: "phone-hash",
      registrationHash: null,
      requestedSlug: "shared-code",
    });

    expect(reasons).toContain("DUPLICATE_SLUG");
    expect(stallCount).toHaveBeenCalledWith({
      where: { code: { equals: "SHARED-CODE", mode: "insensitive" } },
    });
  });
});
