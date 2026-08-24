import { describe, expect, it } from "vitest";
import { resolveDeliverySecret } from "./delivery-secret-resolver";

describe("delivery secret references", () => {
  it("resolves only an allowlisted reference to its injected environment value", () => {
    expect(resolveDeliverySecret(
      "vercel://delivery/FOODPANDA_CLIENT_SECRET",
      { NODE_ENV: "test", FOODPANDA_CLIENT_SECRET: "  test-secret  " },
    )).toBe("test-secret");
  });

  it.each([
    "FOODPANDA_CLIENT_SECRET",
    "file://FOODPANDA_CLIENT_SECRET",
    "vercel://delivery/lowercase-secret",
    "vercel://delivery/../FOODPANDA_CLIENT_SECRET?x=1",
  ])("rejects unsupported or unsafe reference %s", (reference) => {
    expect(() => resolveDeliverySecret(reference, {
      NODE_ENV: "test",
      FOODPANDA_CLIENT_SECRET: "test-secret",
    })).toThrowError(expect.objectContaining({ code: "INVALID_CREDENTIALS" }));
  });

  it("fails closed when the referenced secret has not been injected", () => {
    expect(() => resolveDeliverySecret(
      "external-secret-manager://delivery/UBER_EATS_CLIENT_SECRET",
      { NODE_ENV: "test" },
    )).toThrowError(expect.objectContaining({ code: "PROVIDER_NOT_APPROVED" }));
  });
});
