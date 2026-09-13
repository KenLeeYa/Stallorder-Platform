import { describe, expect, it } from "vitest";
import { isPrivateWebhookAddress } from "./webhook-destination";
import { isSafeWebhookUrl } from "./developer-contract";
describe("webhook non-public address boundary", () => {
  it.each(["::", "::ffff:127.0.0.1", "::ffff:7f00:1", "100.64.0.1", "224.0.0.1", "fd00::1", "fe80::1"])("rejects %s in both configuration and DNS resolution", (address) => {
    expect(isPrivateWebhookAddress(address)).toBe(true);
    expect(isSafeWebhookUrl(`https://${address.includes(":") ? `[${address}]` : address}/`)).toBe(false);
  });
});
