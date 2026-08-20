import type { StaffOrderDto } from "@/lib/orders";

export type StaffOrderSnapshot = {
  onlineOrders: StaffOrderDto[];
  mergedOrders: StaffOrderDto[];
};

type StaffOrderRefreshRequest<T> = {
  silent?: boolean;
  load: () => Promise<T>;
  apply: (value: T) => void;
  onManualRefreshStart?: () => void;
  onRefreshingChange?: (refreshing: boolean) => void;
  onError?: (error: unknown) => void;
};

export function createStaffOrderRefreshController<T>() {
  let inFlight = false;
  let queued = false;
  let disposed = false;
  let manualRefreshActive = false;
  let manualRequest: StaffOrderRefreshRequest<T> | null = null;
  let latestRequest: StaffOrderRefreshRequest<T> | null = null;
  const idleWaiters = new Set<() => void>();

  const finish = () => {
    inFlight = false;
    if (manualRefreshActive) {
      manualRefreshActive = false;
      if (!disposed) manualRequest?.onRefreshingChange?.(false);
      manualRequest = null;
    }
    idleWaiters.forEach((resolve) => resolve());
    idleWaiters.clear();
  };

  const run = async () => {
    inFlight = true;
    while (!disposed) {
      const request = latestRequest;
      if (!request) break;
      queued = false;
      let value: T | undefined;
      let error: unknown;
      try {
        value = await request.load();
      } catch (caught) {
        error = caught;
      }

      if (disposed) break;
      if (queued) continue;
      if (error !== undefined) {
        if (manualRefreshActive) manualRequest?.onError?.(error);
      } else {
        request.apply(value as T);
      }
      break;
    }
    finish();
  };

  return {
    request(request: StaffOrderRefreshRequest<T>) {
      if (disposed) return Promise.resolve();
      latestRequest = request;
      if (!request.silent) {
        request.onManualRefreshStart?.();
        if (!manualRefreshActive) {
          manualRefreshActive = true;
          manualRequest = request;
          request.onRefreshingChange?.(true);
        } else {
          manualRequest = request;
        }
      }
      const idle = new Promise<void>((resolve) => idleWaiters.add(resolve));
      if (inFlight) queued = true;
      else void run();
      return idle;
    },
    dispose() {
      disposed = true;
      queued = false;
      if (!inFlight) finish();
    },
  };
}

export async function loadStaffOrderSnapshot(input: {
  stallId: string;
  stallSlug: string;
  fetchImpl?: typeof fetch;
  loadOfflineOrders: (stallId: string) => Promise<StaffOrderDto[]>;
}): Promise<StaffOrderSnapshot> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(
    `/api/stalls/${input.stallSlug}/orders`,
    { cache: "no-store" },
  );
  const payload = await response.json() as {
    orders?: StaffOrderDto[];
    error?: string;
  };
  if (!response.ok) throw new Error(payload.error ?? "目前無法更新訂單。");
  const onlineOrders = payload.orders ?? [];
  const offlineOrders = await input.loadOfflineOrders(input.stallId);
  return {
    onlineOrders,
    mergedOrders: mergeStaffOrders(onlineOrders, offlineOrders),
  };
}

export function mergeStaffOrders(
  onlineOrders: StaffOrderDto[],
  offlineOrders: StaffOrderDto[],
) {
  const merged = new Map(onlineOrders.map((order) => [order.id, order]));
  offlineOrders.forEach((order) => merged.set(order.id, order));
  return [...merged.values()]
    .sort((left, right) => left.createdAt.localeCompare(right.createdAt));
}
