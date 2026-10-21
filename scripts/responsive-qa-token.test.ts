import { expect, test } from "vitest";
import { generateResponsiveQrToken } from "./responsive-qa-token.mjs";

test("QR token is random and cannot be reconstructed from the public run ID", () => {
  const runId = "12345678-1234-4123-8123-123456789abc";
  const first = generateResponsiveQrToken();
  const second = generateResponsiveQrToken();
  expect(first).toMatch(/^responsive-qa-[A-Za-z0-9_-]{43}$/);
  expect(first).not.toContain(runId);
  expect(first).not.toBe(`responsive-qa-${runId}`);
  expect(second).not.toBe(first);
});
