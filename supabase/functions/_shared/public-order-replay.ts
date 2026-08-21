export function publicOrderReplayPickupCodeLength(
  storedLength: number | null | undefined,
): 3 | 6 {
  return storedLength === 6 ? 6 : 3;
}

export function canonicalPublicOrderTimestamp(value: string) {
  const timestamp = /(?:z|[+-]\d{2}:?\d{2})$/i.test(value) ? value : `${value}Z`;
  const date = new Date(timestamp);
  const fractionalSeconds = value.match(
    /\.(\d+)(?=(?:z|[+-]\d{2}:?\d{2})?$)/i,
  )?.[1];
  if (fractionalSeconds && fractionalSeconds.length > 3 && fractionalSeconds[3] >= "5") {
    date.setTime(date.getTime() + 1);
  }
  return date.toISOString();
}
