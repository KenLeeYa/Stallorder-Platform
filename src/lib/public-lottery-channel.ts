export function publicLotteryChannelAllows(
  orderingMode: string | null | undefined,
  fulfillmentType: string | null | undefined,
) {
  return orderingMode === "DEFAULT" && fulfillmentType !== "DELIVERY";
}
