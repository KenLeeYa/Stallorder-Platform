import "server-only";

import { lookup } from "node:dns/promises";
import { isSafeWebhookUrl } from "@/server/developer-platform/developer-contract";
import { isPrivateWebhookAddress } from "./webhook-address";
export { isPrivateWebhookAddress } from "./webhook-address";

export async function assertPublicWebhookDestination(value: string) {
  if (!isSafeWebhookUrl(value)) throw new Error("WEBHOOK_DESTINATION_UNSAFE");
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "");
  const addresses = await lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some((entry) => isPrivateWebhookAddress(entry.address))) {
    throw new Error("WEBHOOK_DESTINATION_UNSAFE");
  }
}
