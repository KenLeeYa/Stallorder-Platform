import { derivePublicOrderTokens } from "../_shared/crypto.ts";
import { publicOrderReplayPickupCodeLength } from "../_shared/public-order-replay.ts";

type CreatePublicOrderReplayQuote = {
  pickup_code_length?: number | null;
};

export function deriveCreatePublicOrderReplayTokens(
  orderId: string,
  tokenSecret: string,
  quote: CreatePublicOrderReplayQuote,
) {
  return derivePublicOrderTokens(
    orderId,
    tokenSecret,
    publicOrderReplayPickupCodeLength(quote.pickup_code_length),
  );
}
