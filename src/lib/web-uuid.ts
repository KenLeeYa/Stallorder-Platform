export function createWebUuid() {
  const cryptoSource = globalThis.crypto;
  if (typeof cryptoSource?.randomUUID === "function") return cryptoSource.randomUUID();
  if (!cryptoSource || typeof cryptoSource.getRandomValues !== "function") {
    throw new Error("SECURE_RANDOM_UNAVAILABLE");
  }

  const bytes = cryptoSource.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  return [...bytes].map((byte, index) => (
    [4, 6, 8, 10].includes(index)
      ? `-${byte.toString(16).padStart(2, "0")}`
      : byte.toString(16).padStart(2, "0")
  )).join("");
}
