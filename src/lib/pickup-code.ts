export function normalizePickupCode(value: string, length: 3 | 6 = 3) {
  return value.replace(/\D/g, "").slice(0, length);
}

export function isCompletePickupCode(value: string, length: 3 | 6 = 3) {
  return new RegExp(`^\\d{${length}}$`).test(value);
}
