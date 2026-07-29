export const PUBLIC_ORDER_PROTOCOL_VERSION = "1";

export function isSupportedPublicOrderProtocol(value: string | null) {
  return value === null || value === PUBLIC_ORDER_PROTOCOL_VERSION;
}
