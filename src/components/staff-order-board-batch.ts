import type { OrderItemStatus } from "@prisma/client";
import { csrfHeaders } from "@/lib/csrf-client";
import type { StaffOrderDto } from "@/lib/orders";

export type StaffOrderUndoBatch = {
  actionId: string;
  undoExpiresAt: string;
  itemCount: number;
};

type BatchTransport = {
  fetchImpl?: typeof fetch;
  getCsrfHeaders?: () => HeadersInit;
};

export async function updateStaffOrderItemBatch(input: BatchTransport & {
  stallSlug: string;
  itemIds: string[];
  status: Exclude<OrderItemStatus, "PENDING">;
}) {
  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/order-items/batch`,
    {
      method: "PATCH",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify({
        operation: "UPDATE",
        itemIds: input.itemIds,
        status: input.status,
      }),
    },
  );
  const payload = await response.json() as {
    orders: StaffOrderDto[];
    actionId: string;
    undoExpiresAt: string;
    itemCount: number;
    error?: string;
  };
  if (!response.ok) {
    throw new Error(payload.error ?? "目前無法批次更新餐點狀態。");
  }
  return {
    orders: payload.orders,
    undoBatch: {
      actionId: payload.actionId,
      undoExpiresAt: payload.undoExpiresAt,
      itemCount: payload.itemCount,
    } satisfies StaffOrderUndoBatch,
  };
}

export async function undoStaffOrderItemBatch(input: BatchTransport & {
  stallSlug: string;
  actionId: string;
}): Promise<StaffOrderDto[]> {
  const response = await (input.fetchImpl ?? fetch)(
    `/api/stalls/${input.stallSlug}/order-items/batch`,
    {
      method: "PATCH",
      headers: (input.getCsrfHeaders ?? csrfHeaders)(),
      body: JSON.stringify({ operation: "UNDO", actionId: input.actionId }),
    },
  );
  const payload = await response.json() as { orders: StaffOrderDto[]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "目前無法復原餐點狀態。");
  }
  return payload.orders;
}
