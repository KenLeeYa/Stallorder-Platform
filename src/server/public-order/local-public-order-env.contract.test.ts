import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

describe("public ordering environment template", () => {
  it("declares every secret and local Turnstile gate required by Circuit B", () => {
    const example = readFileSync(resolve(process.cwd(), ".env.example"), "utf8");
    for (const name of [
      "ABUSE_HASH_SECRET",
      "TOKEN_DERIVATION_SECRET",
      "TURNSTILE_SECRET_KEY",
      "TURNSTILE_ALLOW_TEST_KEYS",
      "APP_ENV",
    ]) {
      expect(example).toMatch(new RegExp(`^${name}=`, "m"));
    }
  });
});
