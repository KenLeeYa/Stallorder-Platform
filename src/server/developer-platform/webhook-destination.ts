import "server-only";

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { isSafeWebhookUrl } from "@/server/developer-platform/developer-contract";

export function isPrivateWebhookAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  if (isIP(normalized) === 4) {
    const octets = normalized.split(".").map(Number);
    return octets[0] === 10
      || octets[0] === 127
      || octets[0] === 0
      || (octets[0] === 169 && octets[1] === 254)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31)
      || (octets[0] === 192 && octets[1] === 168);
  }
  return isIP(normalized) === 6 && (
    normalized === "::1"
    || normalized.startsWith("fc")
    || normalized.startsWith("fd")
    || /^fe[89ab]/.test(normalized)
  );
}

export async function assertPublicWebhookDestination(value: string) {
  if (!isSafeWebhookUrl(value)) throw new Error("WEBHOOK_DESTINATION_UNSAFE");
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateWebhookAddress(entry.address))) {
    throw new Error("WEBHOOK_DESTINATION_UNSAFE");
  }
}
