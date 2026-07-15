export function formatMoney(amount: number, currency = "TWD", locale = "zh-TW") {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}
