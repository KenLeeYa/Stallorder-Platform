import { DeliveryPlatformError } from "./delivery-platform-errors";

const zeroDecimalCurrencies = new Set(["JPY", "KRW", "TWD", "VND"]);
const amountPattern = /^-?(?:0|[1-9]\d{0,11})(?:\.(\d{1,6}))?$/;

export function providerMajorAmountToInternalUnits(
  amount: string | number,
  currency: string,
) {
  const normalizedCurrency = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalizedCurrency)) throw contractError();
  const scale = zeroDecimalCurrencies.has(normalizedCurrency) ? 0 : 2;
  const normalized = typeof amount === "number" ? String(amount) : amount.trim();
  if (typeof amount === "number" && !Number.isFinite(amount)) throw contractError();
  const match = normalized.match(amountPattern);
  if (!match) throw contractError();
  const negative = normalized.startsWith("-");
  const unsigned = negative ? normalized.slice(1) : normalized;
  const [whole, fraction = ""] = unsigned.split(".");
  if (fraction.length > scale && /[1-9]/.test(fraction.slice(scale))) throw contractError();
  const paddedFraction = fraction.slice(0, scale).padEnd(scale, "0");
  const units = Number(`${whole}${paddedFraction}`);
  if (!Number.isSafeInteger(units) || units > 100_000_000) throw contractError();
  return negative ? -units : units;
}

export function assertProviderMinorAmount(amount: number) {
  if (!Number.isSafeInteger(amount) || amount < 0 || amount > 100_000_000) {
    throw contractError();
  }
  return amount;
}

function contractError() {
  return new DeliveryPlatformError("PROVIDER_CONTRACT_ERROR", { retryable: false });
}
