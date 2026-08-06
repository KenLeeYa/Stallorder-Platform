export type FulfillmentTimeSlot = {
  iso: string;
  timestamp: number;
  date: string;
  hour: string;
  minute: string;
};

export type FulfillmentTimeSlotFilter = Partial<Pick<
  FulfillmentTimeSlot,
  "date" | "hour" | "minute"
>>;

export function buildFulfillmentTimeSlots(
  values: string[],
  timeZone: string,
): FulfillmentTimeSlot[] {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const seen = new Set<string>();

  return values.flatMap((iso) => {
    const value = new Date(iso);
    const timestamp = value.getTime();
    if (
      !Number.isFinite(timestamp)
      || value.getUTCSeconds() !== 0
      || value.getUTCMilliseconds() !== 0
      || seen.has(iso)
    ) {
      return [];
    }

    const parts = Object.fromEntries(
      formatter.formatToParts(value).map((part) => [part.type, part.value]),
    );
    const minute = parts.minute;
    if (
      !parts.year
      || !parts.month
      || !parts.day
      || !parts.hour
      || !minute
      || Number(minute) % 5 !== 0
    ) {
      return [];
    }

    seen.add(iso);
    return [{
      iso,
      timestamp,
      date: `${parts.year}-${parts.month}-${parts.day}`,
      hour: String(Number(parts.hour) % 24).padStart(2, "0"),
      minute,
    }];
  }).sort((left, right) => left.timestamp - right.timestamp);
}

export function findFulfillmentTimeSlot(
  slots: FulfillmentTimeSlot[],
  filter: FulfillmentTimeSlotFilter,
): FulfillmentTimeSlot | null {
  return slots.find((slot) => (
    (filter.date === undefined || slot.date === filter.date)
    && (filter.hour === undefined || slot.hour === filter.hour)
    && (filter.minute === undefined || slot.minute === filter.minute)
  )) ?? null;
}

export function uniqueFulfillmentTimeValues<Key extends keyof FulfillmentTimeSlot>(
  slots: FulfillmentTimeSlot[],
  key: Key,
): Array<FulfillmentTimeSlot[Key]> {
  return [...new Set(slots.map((slot) => slot[key]))];
}
