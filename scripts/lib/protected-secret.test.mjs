import { describe, expect, it } from "vitest";
import { normalizeProtectedSecret } from "./protected-secret.mjs";

describe("protected secret normalization", () => {
  it("keeps an already valid token unchanged", () => {
    expect(normalizeProtectedSecret("valid-token_123")).toEqual({
      value: "valid-token_123",
      changed: false,
    });
  });

  it("removes a leading byte order mark", () => {
    expect(normalizeProtectedSecret("\uFEFFvalid-token")).toEqual({
      value: "valid-token",
      changed: true,
    });
  });

  it("removes surrounding whitespace", () => {
    expect(normalizeProtectedSecret("  valid-token  ")).toEqual({
      value: "valid-token",
      changed: true,
    });
  });

  it.each(["", "   ", "\uFEFF"])("rejects an empty value", (value) => {
    expect(() => normalizeProtectedSecret(value, "VERCEL_TOKEN")).toThrow(
      "VERCEL_TOKEN_MISSING",
    );
  });

  it.each(["valid\nvalue", "valid\u0000value", "valid\tvalue"])(
    "rejects internal control characters",
    (value) => {
      expect(() => normalizeProtectedSecret(value, "VERCEL_TOKEN")).toThrow(
        "VERCEL_TOKEN_CONTAINS_CONTROL_CHARACTER",
      );
    },
  );

  it("rejects internal whitespace", () => {
    expect(() =>
      normalizeProtectedSecret("valid token", "VERCEL_TOKEN"),
    ).toThrow("VERCEL_TOKEN_CONTAINS_WHITESPACE");
  });
});
