import { describe, expect, it } from "vitest";
import { derivePublicOrderTokens } from "../../supabase/functions/_shared/crypto";

describe("公開訂單衍生憑證", () => {
  it("新訂單產生穩定的三位數取餐碼", async () => {
    const first = await derivePublicOrderTokens("order-1", "test-derivation-secret");
    const second = await derivePublicOrderTokens("order-1", "test-derivation-secret");

    expect(first).toEqual(second);
    expect(first.trackingToken).toMatch(/^sto_[A-Za-z0-9_-]+$/);
    expect(first.pickupCode).toMatch(/^\d{3}$/);
  });

  it("部署前訂單仍可重建原六位數取餐碼", async () => {
    const legacy = await derivePublicOrderTokens("order-1", "test-derivation-secret", 6);
    expect(legacy.pickupCode).toMatch(/^\d{6}$/);
  });
});
