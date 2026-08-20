import type { StaffOrderDto } from "@/lib/orders";
import type { OfflineOrder } from "@/offline/offline-order-contract";
import { mergeStaffOrders } from "./staff-order-board-refresh";

type StaffOrderOfflineLoadDependencies = {
  listUnsynchronizedOfflineOrders: (stallId: string) => Promise<OfflineOrder[]>;
  offlineOrderToStaffOrder: (order: OfflineOrder) => StaffOrderDto;
};

type LoadOfflineStaffOrdersOptions = {
  indexedDbAvailable?: () => boolean;
  loadDependencies?: () => Promise<StaffOrderOfflineLoadDependencies>;
};

export type StaffOrderOfflineEnvironment = {
  loadOrders: (stallId: string) => Promise<StaffOrderDto[]>;
  subscribe: (listener: () => void) => () => void;
};

type StartStaffOrderOfflineIntakeInput = {
  stallId: string;
  knownOrderIds: Set<string>;
  updateOrders: (update: (current: StaffOrderDto[]) => StaffOrderDto[]) => void;
  environment?: StaffOrderOfflineEnvironment;
};

export async function loadOfflineStaffOrders(
  stallId: string,
  options: LoadOfflineStaffOrdersOptions = {},
): Promise<StaffOrderDto[]> {
  const indexedDbAvailable = options.indexedDbAvailable
    ?? (() => typeof window !== "undefined" && "indexedDB" in window);
  if (!indexedDbAvailable()) return [];
  try {
    const dependencies = await (options.loadDependencies ?? loadBrowserOfflineDependencies)();
    return (await dependencies.listUnsynchronizedOfflineOrders(stallId))
      .filter((order) => (
        order.orderStatus !== "LOCAL_COMPLETED"
        && order.orderStatus !== "LOCAL_CANCELLED"
      ))
      .map(dependencies.offlineOrderToStaffOrder);
  } catch {
    return [];
  }
}

export function mergeStaffOfflineOrderIntake(
  currentOrders: StaffOrderDto[],
  offlineOrders: StaffOrderDto[],
) {
  return mergeStaffOrders(
    currentOrders.filter((order) => order.source !== "OFFLINE_POS"),
    offlineOrders,
  );
}

export const browserStaffOrderOfflineEnvironment: StaffOrderOfflineEnvironment = {
  loadOrders: loadOfflineStaffOrders,
  subscribe(listener) {
    window.addEventListener("stallorder:offline-data-changed", listener);
    return () => window.removeEventListener("stallorder:offline-data-changed", listener);
  },
};

export function startStaffOrderOfflineIntake({
  stallId,
  knownOrderIds,
  updateOrders,
  environment = browserStaffOrderOfflineEnvironment,
}: StartStaffOrderOfflineIntakeInput) {
  let disposed = false;
  const load = async () => {
    const offlineOrders = await environment.loadOrders(stallId);
    if (disposed) return;
    offlineOrders.forEach((order) => knownOrderIds.add(order.id));
    updateOrders((current) => mergeStaffOfflineOrderIntake(current, offlineOrders));
  };
  void load();
  const unsubscribe = environment.subscribe(() => void load());
  return () => {
    disposed = true;
    unsubscribe();
  };
}

export function refreshStaffOrdersAfterOfflineSync(
  refreshOrders: (silent?: boolean) => Promise<void>,
) {
  return refreshOrders(true);
}

async function loadBrowserOfflineDependencies(): Promise<StaffOrderOfflineLoadDependencies> {
  const [{ listUnsynchronizedOfflineOrders }, { offlineOrderToStaffOrder }] = await Promise.all([
    import("@/offline/offline-operations"),
    import("@/offline/offline-staff-order"),
  ]);
  return { listUnsynchronizedOfflineOrders, offlineOrderToStaffOrder };
}
