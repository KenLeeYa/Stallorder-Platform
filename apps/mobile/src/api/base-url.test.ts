import { describe, expect, it } from "vitest";
import { normalizeApiBaseUrl } from "./base-url";

describe("normalizeApiBaseUrl", () => {
  it("normalizes an HTTPS API origin", () => {
    expect(normalizeApiBaseUrl(" https://preview.example.test/ ")).toBe("https://preview.example.test");
  });

  it("rejects embedded credentials and non-HTTP schemes", () => {
    expect(() => normalizeApiBaseUrl("https://user:secret@example.test")).toThrow("INVALID_MOBILE_API_BASE_URL");
    expect(() => normalizeApiBaseUrl("file:///tmp/api")).toThrow("INVALID_MOBILE_API_BASE_URL");
  });
});
