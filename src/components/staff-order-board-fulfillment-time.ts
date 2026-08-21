import { csrfHeaders } from "@/lib/csrf-client";
import type { StaffOrderDto } from "@/lib/orders";

export type StaffOrderFulfillmentTimeCommand =
  | { operation: "CONFIRM_REQUESTED"; version: number }
  | {
    operation: "PROPOSE";
    version: number;
    proposedFulfillmentAt: string;
    reason: string;
  };

type FulfillmentTimeTransport = {
  fetchImpl?: typeof fetch;
  getCsrfHeaders?: () => HeadersInit;
};

export async function updateStaffOrderFulfillmentTime(input: FulfillmentTimeTransport & {
  stallSlug: string;
  orderId: string;
  command: StaffOrderFulfillmentTimeCommand;
}): Promise<StaffOrderDto> {
  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/orders/${input.orderId}/fulfillment-time`,
    {
      method: "PATCH",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify(input.command),
    },
  );
  const payload = await response.json() as { order?: StaffOrderDto; error?: string };
  if (!response.ok || !payload.order) {
    throw new Error(payload.error ?? "目前無法更新取餐或送達時間。");
  }
  return payload.order;
}
