const clock = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const minutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3));

export function validLastOrderTime(opensAt: string, closesAt: string, lastOrderAt: string | null | undefined) {
  if (!lastOrderAt) return true;
  if (![opensAt, closesAt, lastOrderAt].every((value) => clock.test(value))) return false;
  const duration = (minutes(closesAt) - minutes(opensAt) + 1440) % 1440 || 1440;
  return (minutes(lastOrderAt) - minutes(opensAt) + 1440) % 1440 <= duration;
}
