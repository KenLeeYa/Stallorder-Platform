import type { StaffOrderCheckoutRequest } from "./staff-order-board-checkout";
import { csrfHeaders } from "@/lib/csrf-client";
import type { StaffOrderDto } from "@/lib/orders";

export type StaffOrderManualPickupReason = "DEVICE_LOST" | "TRACKING_UNAVAILABLE" | "OTHER";

export type StaffOrderPickupCommand =
  | { mode: "CODE"; code: string }
  | {
    mode: "MANUAL";
    confirmationOrderNo: string;
    reason: StaffOrderManualPickupReason;
    confirmedCustomerDetails: true;
  };

type FulfillmentTransport = {
  fetchImpl?: typeof fetch;
  getCsrfHeaders?: () => HeadersInit;
};

export async function queueStaffOrderPrint(input: FulfillmentTransport & {
  stallSlug: string;
  orderId: string;
  orderSource: StaffOrderDto["source"] | undefined;
  queueOfflinePrintJob?: (orderId: string) => Promise<unknown>;
}) {
  if (input.orderSource === "OFFLINE_POS") {
    const queueOfflinePrintJob = input.queueOfflinePrintJob
      ?? (await import("@/offline/offline-operations")).queueOfflinePrintJob;
    await queueOfflinePrintJob(input.orderId);
    return "離線訂單已排入本機列印佇列；列印結果會在同步時對帳。";
  }

  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/print-jobs`,
    {
      method: "POST",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify({ operation: "QUEUE", orderId: input.orderId }),
    },
  );
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error ?? "目前無法排入列印工作。");
  return "訂單已排入列印工作佇列。";
}

export async function verifyStaffOrderPickup(input: FulfillmentTransport & {
  stallSlug: string;
  orderId: string;
  command: StaffOrderPickupCommand;
}): Promise<Pick<StaffOrderDto, "pickupVerifiedAt" | "pickupVerificationMethod">> {
  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/orders/${input.orderId}/verify-pickup`,
    {
      method: "POST",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify(input.command),
    },
  );
  const payload = await response.json() as Pick<
    StaffOrderDto,
    "pickupVerifiedAt" | "pickupVerificationMethod"
  > & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? (
      input.command.mode === "MANUAL" ? "人工取餐核對失敗。" : "取餐碼驗證失敗。"
    ));
  }
  return {
    pickupVerifiedAt: payload.pickupVerifiedAt,
    pickupVerificationMethod: payload.pickupVerificationMethod,
  };
}

export async function verifyStaffOrderPickupByCode(input: FulfillmentTransport & {
  stallSlug: string;
  code: string;
}): Promise<StaffOrderDto> {
  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/orders/pickup-code`,
    {
      method: "POST",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify({ code: input.code }),
    },
  );
  const payload = await response.json() as { order?: StaffOrderDto; error?: string };
  if (!response.ok || !payload.order) {
    throw new Error(payload.error ?? "目前無法依取餐碼載入訂單。");
  }
  return payload.order;
}

export async function checkoutStaffDiningTable(input: FulfillmentTransport & {
  stallSlug: string;
  diningTableId: string;
  orderIds: string[];
  checkout: StaffOrderCheckoutRequest;
}) {
  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/table-checkout`,
    {
      method: "PATCH",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify({
        diningTableId: input.diningTableId,
        orderIds: input.orderIds,
        ...input.checkout,
      }),
    },
  );
  const payload = await response.json() as { orderIds?: string[]; error?: string };
  if (!response.ok) throw new Error(payload.error ?? "目前無法完成同桌結帳。");
  return payload.orderIds ?? [];
}
