import { specialClosureBlocksAt, type SpecialClosureView } from "@/lib/special-closures-client";

export function findOrderClosureNotice(closures: readonly SpecialClosureView[], timeZone: string, fulfillmentTimes: readonly (string | null)[]) {
  for (const value of fulfillmentTimes) {
    if (!value) continue;
    const time = new Date(value);
    if (Number.isNaN(time.getTime())) continue;
    const closure = closures.find(candidate => specialClosureBlocksAt(candidate, timeZone, time));
    if (closure) return { closure, fulfillmentAt: value };
  }
  return null;
}
