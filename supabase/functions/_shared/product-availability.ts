export function manualProductPauseActive(
  soldOut: boolean,
  until: Date | string | null | undefined,
  now = new Date(),
) {
  return soldOut && (!until || new Date(until).getTime() > now.getTime());
}
