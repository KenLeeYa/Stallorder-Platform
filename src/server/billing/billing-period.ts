export type BillingCycleContract = {
  billingTimezone: string;
  billingCycleAnchorDay: number;
  billingPeriodType: string;
};

export function assertSupportedBillingCycle(contract: BillingCycleContract) {
  if (contract.billingCycleAnchorDay !== 1 || contract.billingPeriodType !== "CALENDAR_MONTH") {
    throw new Error("PAYG_BILLING_CYCLE_UNSUPPORTED");
  }
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: contract.billingTimezone }).format(new Date(0));
  } catch {
    throw new Error("PAYG_BILLING_TIMEZONE_INVALID");
  }
}

export function billingPeriodForInstant(instant: Date, contract: BillingCycleContract) {
  assertSupportedBillingCycle(contract);
  const parts = dateParts(instant, contract.billingTimezone);
  return new Date(Date.UTC(parts.year, parts.month - 1, 1));
}

export function billingPeriodEndInstant(period: Date, contract: BillingCycleContract) {
  assertSupportedBillingCycle(contract);
  const year = period.getUTCFullYear();
  const month = period.getUTCMonth() + 1;
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  return zonedMidnight(nextYear, nextMonth, 1, contract.billingTimezone);
}

export function billingPeriodStartInstant(period: Date, contract: BillingCycleContract) {
  assertSupportedBillingCycle(contract);
  return zonedMidnight(
    period.getUTCFullYear(),
    period.getUTCMonth() + 1,
    contract.billingCycleAnchorDay,
    contract.billingTimezone,
  );
}

export function hasBillingPeriodEnded(period: Date, contract: BillingCycleContract, now = new Date()) {
  return billingPeriodEndInstant(period, contract).getTime() <= now.getTime();
}

function zonedMidnight(year: number, month: number, day: number, timeZone: string) {
  const target = Date.UTC(year, month - 1, day);
  let guess = target;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const parts = dateTimeParts(new Date(guess), timeZone);
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second);
    const next = target - (represented - guess);
    if (next === guess) break;
    guess = next;
  }
  return new Date(guess);
}

function dateParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  return {
    year: numberPart(parts, "year"),
    month: numberPart(parts, "month"),
    day: numberPart(parts, "day"),
  };
}

function dateTimeParts(value: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(value);
  return {
    ...dateParts(value, timeZone),
    hour: numberPart(parts, "hour"),
    minute: numberPart(parts, "minute"),
    second: numberPart(parts, "second"),
  };
}

function numberPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes) {
  const value = Number(parts.find((part) => part.type === type)?.value);
  if (!Number.isInteger(value)) throw new Error("PAYG_BILLING_TIMEZONE_INVALID");
  return value;
}
