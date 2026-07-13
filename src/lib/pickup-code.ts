export function normalizePickupCode(value: string) {
  return value.replace(/\D/g, "").slice(0, 6);
}

export function isCompletePickupCode(value: string) {
  return /^\d{6}$/.test(value);
}
