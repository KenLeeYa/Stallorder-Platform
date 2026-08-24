import "server-only";

import { prisma } from "@/lib/prisma";
import { readBoundedText } from "./bounded-text-reader";
import { DeliveryPlatformError } from "./delivery-platform-errors";
import type { DeliveryProvider } from "./delivery-platform-types";
import { parseFoodpandaOrder } from "./providers/foodpanda/foodpanda-normalizer";
import { parseUberEatsWebhookRoutingHint } from "./providers/uber-eats/uber-eats-webhook";

const MAX_WEBHOOK_BYTES = 128_000;

export async function resolveCanonicalDeliveryWebhook(input: {
  provider: Exclude<DeliveryProvider, "MOCK">;
  request: Request;
}) {
  const contentType = input.request.headers.get("content-type")?.split(";", 1)[0].toLowerCase();
  if (
    input.request.method !== "POST"
    || contentType !== "application/json"
  ) throw invalidWebhook();
  let rawBody: string;
  try {
    rawBody = await readBoundedText(input.request, MAX_WEBHOOK_BYTES);
  } catch {
    throw invalidWebhook();
  }
  if (rawBody.length === 0) throw invalidWebhook();
  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw invalidWebhook();
  }
  let externalStoreId: string;
  try {
    externalStoreId = input.provider === "UBER_EATS"
      ? parseUberEatsWebhookRoutingHint(payload).externalStoreId
      : parseFoodpandaOrder(payload).client.store_id;
  } catch {
    throw invalidWebhook();
  }
  const connection = await prisma.deliveryPlatformConnection.findFirst({
    where: {
      provider: input.provider,
      externalStoreId,
      status: "ACTIVE",
    },
    select: { id: true },
  });
  if (!connection) throw invalidWebhook();
  return {
    connectionId: connection.id,
    request: new Request(input.request.url, {
      method: "POST",
      headers: input.request.headers,
      body: rawBody,
    }),
  };
}

function invalidWebhook() {
  return new DeliveryPlatformError("INVALID_WEBHOOK", { retryable: false });
}
