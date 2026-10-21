import { BlockList, isIP } from "node:net";

const blockedV4 = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.168.0.0", 16], ["224.0.0.0", 4], ["240.0.0.0", 4],
] as const) blockedV4.addSubnet(address, prefix, "ipv4");
const globalV6 = new BlockList(); globalV6.addSubnet("2000::", 3, "ipv6");
export function isPrivateWebhookAddress(address: string) {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "");
  const version = isIP(normalized);
  if (version === 4) return blockedV4.check(normalized, "ipv4");
  // Deny mapped IPv4, unspecified, local, multicast and scoped interface addresses.
  if (version === 6) return normalized.includes("%") || !globalV6.check(normalized, "ipv6");
  return true;
}
