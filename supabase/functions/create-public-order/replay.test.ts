import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { deriveCreatePublicOrderReplayTokens } from "./replay";

const handlerSource = readFileSync(
  fileURLToPath(new URL("./index.ts", import.meta.url)),
  "utf8",
);

describe("create-public-order replay", () => {
  it.each([3, 6] as const)(
    "derives the replay pickup code from the stored %s-digit quote setting",
    async (pickupCodeLength) => {
      const tokens = await deriveCreatePublicOrderReplayTokens(
        "11111111-1111-4111-8111-111111111111",
        "test-secret",
        { pickup_code_length: pickupCodeLength },
      );

      expect(tokens.pickupCode).toHaveLength(pickupCodeLength);
    },
  );

  it("passes the canonical stored replay quote from preflight into token derivation", () => {
    expect(handlerSource).toContain("pickup_code_length?: number | null;");
    expect(handlerSource).toContain(
      "deriveCreatePublicOrderReplayTokens(existing.order_id, tokenSecret, existing)",
    );
  });
});
