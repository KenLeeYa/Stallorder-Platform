"use client";

import type { OrderItemStatus, OrderStatus, UserRole } from "@prisma/client";
import Link from "next/link";
import {
  CheckCheck,
  CheckCircle2,
  ChefHat,
  Clock3,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MapPinned,
  PackageCheck,
  Play,
  Printer,
  RefreshCw,
  Search,
  ShoppingCart,
  Truck,
  Undo2,
  Volume2,
  VolumeX,
  WalletCards,
  Wifi,
  WifiOff,
} from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { OfflineBootstrapControl } from "@/components/offline-bootstrap-control";
import { OfflineQueueStatus } from "@/components/offline-queue-status";
import { PwaControls } from "@/components/pwa-controls";
import { StaffCapacityControl } from "@/components/staff-capacity-control";
import { StaffOrderComposer } from "@/components/staff-order-composer";
import type { StaffOrderUndoBatch } from "@/components/staff-order-board-batch";
import {
  StaffOrderCancellationDialog,
  type StaffOrderCancellationController,
} from "@/components/staff-order-board-cancellation";
import {
  StaffOrderCheckoutDialog,
  type StaffOrderCheckoutController,
} from "@/components/staff-order-board-checkout-lifecycle";
import type { StaffOrderFulfillmentTimeCommand } from "@/components/staff-order-board-fulfillment-time";
import type { StaffOrderLiveConnectionState } from "@/components/staff-order-board-live";
import {
  StaffOrderManualPickupDialog,
  type StaffOrderManualPickupController,
} from "@/components/staff-order-board-manual-pickup";
import type { StaffOrderPosSnapshot } from "@/components/staff-order-board-pos";
import type { StaffOrderProductionStatus } from "@/components/staff-order-board-production";
import type {
  StaffOrderDiningTableGroup,
  StaffOrderKitchenGroup,
} from "@/components/staff-order-board-selectors";
import {
  StaffOrderTimeProposalDialog,
  type StaffOrderTimeProposalController,
} from "@/components/staff-order-board-time-proposal";
import { WorkModeSwitcher } from "@/components/work-mode-switcher";
import { formatMoney } from "@/lib/money";
import { canTransitionOrderItem } from "@/lib/order-item-status";
import {
  orderItemStatusLabels,
  orderStatusLabels,
  paymentStatusLabels,
  staffStatusOptions,
  type StaffOrderDto,
} from "@/lib/orders";
import { canTransitionOrder, hasPermission, roleLabels } from "@/lib/rbac";
import type { WorkModeDestination } from "@/lib/work-mode";

export type StaffOrderBoardViewMode = "TICKETS" | "TABLES" | "SUMMARY";

type SelectedItem = StaffOrderDto["items"][number] & {
  orderId: string;
  fulfillmentTimeState: StaffOrderDto["fulfillmentTimeState"];
};

type Stall = {
  id: string;
  organizationId: string;
  slug: string;
  name: string;
  currency: string;
  timezone: string;
};

type Actions = {
  onClearSelectedItems: () => void;
  onCloseComposer: () => void;
  onCompletePaidOrders: (orders: StaffOrderDto[]) => Promise<void>;
  onOpenCheckout: (orders: StaffOrderDto | StaffOrderDto[]) => Promise<void>;
  onOpenComposer: () => Promise<void>;
  onPickupCodeChange: (orderId: string, value: string) => void;
  onPrintOrder: (orderId: string) => Promise<void>;
  onQueryChange: (query: string) => void;
  onRefresh: () => void;
  onSynchronized: () => void;
  onToggleAlerts: () => void;
  onToggleSelectedItem: (itemId: string, selected: boolean) => void;
  onUndoSelectedItems: () => Promise<void>;
  onUpdateAllItemStatuses: (
    orderId: string,
    status: "PREPARING" | "READY" | "SERVED",
  ) => Promise<void>;
  onUpdateFulfillmentTime: (
    order: StaffOrderDto,
    command: StaffOrderFulfillmentTimeCommand,
  ) => Promise<boolean>;
  onUpdateItemStatus: (
    orderId: string,
    itemId: string,
    status: Exclude<OrderItemStatus, "PENDING">,
  ) => Promise<void>;
  onUpdateOrder: (orderId: string, status: StaffOrderProductionStatus) => Promise<boolean>;
  onUpdateSelectedItems: (
    itemIds: string[],
    status: "PREPARING" | "READY" | "SERVED",
  ) => Promise<void>;
  onViewModeChange: (mode: StaffOrderBoardViewMode) => void;
  onCreated: (order: StaffOrderDto) => void;
};

export type StaffOrderBoardPresentationProps = {
  stall: Stall;
  account: { displayName: string; role: UserRole };
  modules: StaffOrderPosSnapshot["modules"];
  paymentOptions: StaffOrderPosSnapshot["paymentOptions"];
  discountOptions: StaffOrderPosSnapshot["discountOptions"];
  orderCatalog: StaffOrderPosSnapshot["catalog"];
  capacity: StaffOrderPosSnapshot["capacity"];
  workModeDestinations: WorkModeDestination[];
  appVersion: string;
  filteredOrders: StaffOrderDto[];
  orders: StaffOrderDto[];
  selectedItems: SelectedItem[];
  canUpdateSelection: boolean;
  nextSelectedStatus: "PREPARING" | "READY" | "SERVED" | null;
  kitchenGroups: StaffOrderKitchenGroup[];
  diningTableGroups: StaffOrderDiningTableGroup[];
  selectedItemIds: ReadonlySet<string>;
  pickupCodes: Record<string, string>;
  query: string;
  now: number;
  viewMode: StaffOrderBoardViewMode;
  liveConnection: StaffOrderLiveConnectionState;
  alertsEnabled: boolean;
  isRefreshing: boolean;
  message: string;
  batchBusy: boolean;
  undoBatch: StaffOrderUndoBatch | null;
  composerOpen: boolean;
  posConfigurationLoading: boolean;
  updatingOrderId: string | null;
  updatingItemId: string | null;
  updatingItemsOrderId: string | null;
  verifyingPickupOrderId: string | null;
  cancellation: StaffOrderCancellationController;
  checkout: StaffOrderCheckoutController;
  manualPickup: StaffOrderManualPickupController;
  timeProposal: StaffOrderTimeProposalController;
  actions: Actions;
};

export function StaffOrderBoardPresentation(props: StaffOrderBoardPresentationProps) {
  const {
    stall,
    account,
    filteredOrders,
    selectedItems,
    kitchenGroups,
    diningTableGroups,
    viewMode,
    actions,
  } = props;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-3 md:px-8 md:py-5">
      <StaffOrderBoardToolbar
        stall={stall}
        account={account}
        modules={props.modules}
        orderCatalog={props.orderCatalog}
        capacity={props.capacity}
        workModeDestinations={props.workModeDestinations}
        appVersion={props.appVersion}
        query={props.query}
        viewMode={viewMode}
        liveConnection={props.liveConnection}
        alertsEnabled={props.alertsEnabled}
        isRefreshing={props.isRefreshing}
        message={props.message}
        posConfigurationLoading={props.posConfigurationLoading}
        actions={actions}
      />
      <StaffOrderBatchBars
        selectedItems={selectedItems}
        canUpdateSelection={props.canUpdateSelection}
        nextSelectedStatus={props.nextSelectedStatus}
        batchBusy={props.batchBusy}
        undoBatch={props.undoBatch}
        actions={actions}
      />
      {account.role === "KITCHEN" && viewMode === "SUMMARY" ? (
        <StaffKdsSummary
          groups={kitchenGroups}
          role={account.role}
          batchBusy={props.batchBusy}
          onUpdateSelectedItems={actions.onUpdateSelectedItems}
        />
      ) : viewMode === "TABLES" ? (
        <StaffTableGroups
          groups={diningTableGroups}
          currency={stall.currency}
          updatingOrderId={props.updatingOrderId}
          posConfigurationLoading={props.posConfigurationLoading}
          onOpenCheckout={actions.onOpenCheckout}
          onCompletePaidOrders={actions.onCompletePaidOrders}
        />
      ) : (
        <StaffTicketList
          orders={filteredOrders}
          currency={stall.currency}
          role={account.role}
          printEnabled={props.modules.print}
          now={props.now}
          selectedItemIds={props.selectedItemIds}
          pickupCodes={props.pickupCodes}
          updatingOrderId={props.updatingOrderId}
          updatingItemId={props.updatingItemId}
          updatingItemsOrderId={props.updatingItemsOrderId}
          verifyingPickupOrderId={props.verifyingPickupOrderId}
          cancellation={props.cancellation}
          manualPickup={props.manualPickup}
          timeProposal={props.timeProposal}
          actions={actions}
        />
      )}
      {viewMode === "TICKETS" && filteredOrders.length === 0 ? (
        <p className="mt-10 text-center text-sm text-stone-500 print:hidden">
          {props.query ? "找不到符合條件的訂單。" : "目前沒有待處理訂單。"}
        </p>
      ) : null}
      <StaffPosComposerAndDialogs
        stall={stall}
        account={account}
        modules={props.modules}
        paymentOptions={props.paymentOptions}
        discountOptions={props.discountOptions}
        orderCatalog={props.orderCatalog}
        orders={props.orders}
        composerOpen={props.composerOpen}
        updatingOrderId={props.updatingOrderId}
        verifyingPickupOrderId={props.verifyingPickupOrderId}
        message={props.message}
        cancellation={props.cancellation}
        checkout={props.checkout}
        manualPickup={props.manualPickup}
        timeProposal={props.timeProposal}
        actions={actions}
      />
    </main>
  );
}

type StaffOrderBoardToolbarProps = Pick<
  StaffOrderBoardPresentationProps,
  | "stall"
  | "account"
  | "modules"
  | "orderCatalog"
  | "capacity"
  | "workModeDestinations"
  | "appVersion"
  | "query"
  | "viewMode"
  | "liveConnection"
  | "alertsEnabled"
  | "isRefreshing"
  | "message"
  | "posConfigurationLoading"
> & {
  actions: Pick<
    Actions,
    | "onOpenComposer"
    | "onQueryChange"
    | "onRefresh"
    | "onSynchronized"
    | "onToggleAlerts"
    | "onViewModeChange"
  >;
};

function StaffOrderBoardToolbar({
  stall,
  account,
  modules,
  orderCatalog,
  capacity,
  workModeDestinations,
  appVersion,
  query,
  viewMode,
  liveConnection,
  alertsEnabled,
  isRefreshing,
  message,
  posConfigurationLoading,
  actions,
}: StaffOrderBoardToolbarProps) {
  const role = account.role;
  return (
    <>
      <div className="flex min-w-0 max-w-full flex-col gap-3 print:hidden sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-teal-800">行動訂單看板</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">{stall.name}</h1>
          <p className="mt-1 text-xs text-stone-500">{account.displayName} · {roleLabels[role]}</p>
        </div>
        <div className="flex w-full min-w-0 max-w-full gap-2 sm:w-auto sm:flex-wrap sm:justify-end">
          <div className="flex min-w-0 flex-1 flex-nowrap justify-start gap-2 overflow-x-auto contain-paint pb-1 [&>*]:shrink-0 sm:contents">
            <WorkModeSwitcher destinations={workModeDestinations} currentMode="STAFF" organizationId={stall.organizationId} stallId={stall.id} offlineGuardStallId={stall.id} className="w-auto shrink-0" />
            {orderCatalog && hasPermission(role, "CREATE_ORDERS") ? (
              <button type="button" disabled={posConfigurationLoading} onClick={() => void actions.onOpenComposer()} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white disabled:cursor-wait disabled:opacity-60"><ShoppingCart className="h-4 w-4" /><span>店員點餐</span></button>
            ) : null}
            {modules.dineIn ? <Link href={`/staff/${stall.slug}/floor`} title="桌位平面圖" className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold"><MapPinned className="h-4 w-4" /><span className="hidden sm:inline">桌位平面圖</span></Link> : null}
            {modules.print && hasPermission(role, "MANAGE_PRINT_QUEUE") ? <Link href={`/staff/${stall.slug}/print`} title="列印工作佇列" className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold"><Printer className="h-4 w-4" /><span className="hidden lg:inline">列印佇列</span></Link> : null}
            {hasPermission(role, "MANAGE_CASH_SHIFT") ? <Link href={`/staff/${stall.slug}/cash`} title="現金交班" className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold"><WalletCards className="h-4 w-4" /><span className="hidden lg:inline">現金交班</span></Link> : null}
            <LiveConnectionBadge state={liveConnection} />
            <button type="button" role="switch" aria-checked={alertsEnabled} onClick={actions.onToggleAlerts} title={alertsEnabled ? "關閉新訂單聲音與震動" : "開啟新訂單聲音與震動"} className={`inline-flex h-10 w-10 items-center justify-center rounded-md border ${alertsEnabled ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600"}`}>
              {alertsEnabled ? <Volume2 className="h-4 w-4" /> : <VolumeX className="h-4 w-4" />}<span className="sr-only">{alertsEnabled ? "新訂單提醒已開啟" : "新訂單提醒已關閉"}</span>
            </button>
            <PwaControls showWakeLock />
          </div>
          <OfflineBootstrapControl stallId={stall.id} stallSlug={stall.slug} appVersion={appVersion} />
          <button type="button" onClick={actions.onRefresh} title="重新整理" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-stone-300 bg-white"><RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} /><span className="sr-only">重新整理</span></button>
          <LogoutButton offlineStallId={stall.id} />
        </div>
      </div>
      <OfflineQueueStatus stallId={stall.id} stallSlug={stall.slug} onSynchronized={actions.onSynchronized} />
      {message ? <p role="status" className={`mt-4 text-sm print:hidden ${/(無法|失敗|中斷|錯誤|期限|找不到)/.test(message) ? "text-red-700" : "text-emerald-700"}`}>{message}</p> : null}
      {capacity ? <StaffCapacityControl stallSlug={stall.slug} initialData={capacity} /> : null}
      <div className="mt-4 flex flex-col gap-2 sm:mt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 print:hidden">
        <label className="relative block w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" /><span className="sr-only">搜尋桌號或訂單編號</span><input type="search" value={query} maxLength={120} onChange={(event) => actions.onQueryChange(event.target.value)} placeholder="搜尋桌號、訂單編號或顧客" className="h-11 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-sm" /></label>
        {role === "KITCHEN" ? (
          <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label="廚房檢視模式"><button type="button" aria-pressed={viewMode === "TICKETS"} onClick={() => actions.onViewModeChange("TICKETS")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TICKETS" ? "bg-stone-900 text-white" : "text-stone-600"}`}>訂單票</button><button type="button" aria-pressed={viewMode === "SUMMARY"} onClick={() => actions.onViewModeChange("SUMMARY")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "SUMMARY" ? "bg-stone-900 text-white" : "text-stone-600"}`}>同品項彙總</button></div>
        ) : modules.dineIn ? (
          <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label="訂單顯示模式"><button type="button" aria-pressed={viewMode === "TICKETS"} onClick={() => actions.onViewModeChange("TICKETS")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TICKETS" ? "bg-stone-900 text-white" : "text-stone-600"}`}>逐筆訂單</button><button type="button" aria-pressed={viewMode === "TABLES"} onClick={() => actions.onViewModeChange("TABLES")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TABLES" ? "bg-stone-900 text-white" : "text-stone-600"}`}>同桌合併</button></div>
        ) : null}
      </div>
    </>
  );
}

function StaffOrderBatchBars({
  selectedItems,
  canUpdateSelection,
  nextSelectedStatus,
  batchBusy,
  undoBatch,
  actions,
}: Pick<StaffOrderBoardPresentationProps, "selectedItems" | "canUpdateSelection" | "nextSelectedStatus" | "batchBusy" | "undoBatch"> & {
  actions: Pick<Actions, "onClearSelectedItems" | "onUndoSelectedItems" | "onUpdateSelectedItems">;
}) {
  return (
    <>
      {selectedItems.length > 0 ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-stone-200 bg-stone-50 px-3 py-3 print:hidden"><span className="text-sm font-semibold">已選 {selectedItems.length} 個餐點品項</span><div className="flex gap-2"><button type="button" onClick={actions.onClearSelectedItems} className="h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold">清除選取</button><button type="button" disabled={!canUpdateSelection || batchBusy || !nextSelectedStatus} onClick={() => nextSelectedStatus && void actions.onUpdateSelectedItems(selectedItems.map((item) => item.id), nextSelectedStatus)} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><ListChecks className="h-4 w-4" />{nextSelectedStatus ? `批次${batchActionLabel(nextSelectedStatus)}` : "請選擇相同狀態"}</button></div></div> : null}
      {undoBatch ? <div role="status" className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 print:hidden"><span>已更新 {undoBatch.itemCount} 個餐點，5 秒內可復原。</span><button type="button" disabled={batchBusy} onClick={() => void actions.onUndoSelectedItems()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-amber-700 px-3 text-xs font-semibold"><Undo2 className="h-4 w-4" />復原</button></div> : null}
    </>
  );
}

function StaffKdsSummary({ groups, role, batchBusy, onUpdateSelectedItems }: {
  groups: StaffOrderKitchenGroup[];
  role: UserRole;
  batchBusy: boolean;
  onUpdateSelectedItems: Actions["onUpdateSelectedItems"];
}) {
  return <div className="mt-6 divide-y divide-stone-200 border-y border-stone-200 print:hidden">{groups.map((group) => {
    const nextStatus = nextOperationalItemStatus(group.status);
    const canUpdate = nextStatus && canTransitionOrderItem(group.status, nextStatus, role);
    return <article key={group.key} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><ChefHat className="h-4 w-4 text-teal-700" /><h2 className="font-semibold">{group.quantity} × {group.name}</h2><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{orderItemStatusLabels[group.status]}</span></div>{group.notes ? <p className="mt-1 text-xs text-teal-800">{group.notes}</p> : null}<p className="mt-2 text-xs text-stone-500">來源：{group.tickets.join("、")}</p></div>{canUpdate && nextStatus ? <button type="button" disabled={batchBusy} onClick={() => void onUpdateSelectedItems(group.itemIds, nextStatus)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><ListChecks className="h-4 w-4" />{batchActionLabel(nextStatus)}全部</button> : null}</article>;
  })}{groups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">目前沒有待製作餐點。</p> : null}</div>;
}

function StaffTableGroups({ groups, currency, updatingOrderId, posConfigurationLoading, onOpenCheckout, onCompletePaidOrders }: {
  groups: StaffOrderDiningTableGroup[];
  currency: string;
  updatingOrderId: string | null;
  posConfigurationLoading: boolean;
  onOpenCheckout: Actions["onOpenCheckout"];
  onCompletePaidOrders: Actions["onCompletePaidOrders"];
}) {
  return <div className="mt-6 grid gap-4 md:grid-cols-2 print:hidden">{groups.map((group) => {
    const allServed = group.orders.every((order) => order.items.every((item) => item.status === "SERVED"));
    const checkoutEligible = allServed && group.orders.every((order) => order.status === "READY");
    const unpaidOrders = group.orders.filter((order) => order.paymentStatus === "UNPAID");
    const pendingItems = group.orders.flatMap((order) => order.items).filter((item) => item.status !== "SERVED").length;
    return <article key={group.diningTableId} className="rounded-lg border border-stone-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{group.tableLabel}</h2><p className="mt-1 text-xs text-stone-500">{group.orders.length} 筆追加訂單 · {group.orders.reduce((sum, order) => sum + order.items.reduce((count, item) => count + item.quantity, 0), 0)} 份餐點</p></div><strong>{formatMoney(group.orders.reduce((sum, order) => sum + order.total, 0), currency)}</strong></div><div className="mt-4 divide-y divide-stone-100 border-y border-stone-200">{group.orders.map((order) => <div key={order.id} className="py-3"><div className="flex items-center justify-between gap-3 text-sm"><strong>訂單 {order.orderNo}</strong><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{orderStatusLabels[order.status]}</span></div><p className="mt-1 text-xs text-stone-600">{order.items.map((item) => `${item.quantity}×${item.name}`).join("、")}</p><p className="mt-1 text-xs text-stone-500">{paymentStatusLabels[order.paymentStatus]}</p></div>)}</div><div className="mt-4 flex items-center justify-between gap-3"><span className={`text-xs font-semibold ${pendingItems === 0 ? "text-emerald-700" : "text-amber-800"}`}>{pendingItems === 0 ? "餐點皆已出餐" : `${pendingItems} 個品項尚未出餐`}</span><button type="button" disabled={!checkoutEligible || updatingOrderId !== null || posConfigurationLoading} onClick={() => unpaidOrders.length > 0 ? void onOpenCheckout(unpaidOrders) : void onCompletePaidOrders(group.orders)} className="h-10 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{unpaidOrders.length > 0 ? unpaidOrders.length > 1 ? `合併結帳（${unpaidOrders.length} 筆）` : "完成此桌結帳" : "完成此桌"}</button></div></article>;
  })}{groups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500 md:col-span-2">目前沒有內用桌位訂單。</p> : null}</div>;
}

type StaffTicketListProps = Pick<
  StaffOrderBoardPresentationProps,
  | "selectedItemIds"
  | "pickupCodes"
  | "now"
  | "updatingOrderId"
  | "updatingItemId"
  | "updatingItemsOrderId"
  | "verifyingPickupOrderId"
  | "cancellation"
  | "manualPickup"
  | "timeProposal"
> & {
  orders: StaffOrderDto[];
  currency: string;
  role: UserRole;
  printEnabled: boolean;
  actions: Pick<
    Actions,
    | "onOpenCheckout"
    | "onPickupCodeChange"
    | "onPrintOrder"
    | "onToggleSelectedItem"
    | "onUpdateAllItemStatuses"
    | "onUpdateFulfillmentTime"
    | "onUpdateItemStatus"
    | "onUpdateOrder"
  >;
};

function StaffTicketList({ orders, currency, role, printEnabled, now, selectedItemIds, pickupCodes, updatingOrderId, updatingItemId, updatingItemsOrderId, verifyingPickupOrderId, cancellation, manualPickup, timeProposal, actions }: StaffTicketListProps) {
  return <div className="mt-6 grid gap-4 md:grid-cols-2 print:block">{orders.map((order) => <StaffOrderTicket key={order.id} order={order} currency={currency} role={role} printEnabled={printEnabled} now={now} selectedItemIds={selectedItemIds} pickupCode={pickupCodes[order.id] ?? ""} updatingOrderId={updatingOrderId} updatingItemId={updatingItemId} updatingItemsOrderId={updatingItemsOrderId} verifyingPickupOrderId={verifyingPickupOrderId} cancellation={cancellation} manualPickup={manualPickup} timeProposal={timeProposal} actions={actions} />)}</div>;
}

function StaffOrderTicket({ order, currency, role, printEnabled, now, selectedItemIds, pickupCode, updatingOrderId, updatingItemId, updatingItemsOrderId, verifyingPickupOrderId, cancellation, manualPickup, timeProposal, actions }: Omit<StaffTicketListProps, "orders" | "pickupCodes"> & { order: StaffOrderDto; pickupCode: string }) {
  return (
    <article className={`rounded-lg border p-4 ${orderAgeClasses(order.createdAt, now)}`}>
      <div className="flex items-start justify-between gap-4"><div><div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-stone-500"><span>訂單 {order.orderNo}</span>{order.isTest ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">開店測試訂單</span> : null}{order.source === "OFFLINE_POS" ? <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-900">本機待同步</span> : null}</div><h2 className="mt-1 font-semibold">{order.customerName}</h2><p className="mt-1 text-sm text-stone-500">{order.fulfillmentType === "DINE_IN" ? `內用 · ${order.tableLabel ?? "未指定桌位"}` : order.fulfillmentType === "DELIVERY" ? "外送訂單" : "外帶取餐"} · {new Date(order.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })} · 已等待 {orderAgeMinutes(order.createdAt, now)} 分</p></div><span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">{orderStatusLabels[order.status]}</span></div>
      {order.fulfillmentType === "DELIVERY" ? <div className="mt-3 flex items-start gap-2 border-y border-stone-200 bg-stone-50 px-3 py-3 text-sm"><Truck className="mt-0.5 h-4 w-4 shrink-0 text-teal-800" /><div className="min-w-0"><p className="font-medium break-words">{order.deliveryAddress}</p>{order.customerPhone ? <p className="mt-1 text-stone-600">{order.customerPhone}</p> : null}</div></div> : null}
      {order.fulfillmentType !== "DINE_IN" && order.fulfillmentTimeState !== "NOT_REQUESTED" ? <div className={`mt-3 rounded-md border px-3 py-3 text-sm ${order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? "border-amber-300 bg-amber-50 text-amber-950" : order.fulfillmentTimeState === "DECLINED" || order.fulfillmentTimeState === "EXPIRED" ? "border-red-200 bg-red-50 text-red-900" : "border-teal-200 bg-teal-50 text-teal-950"}`}><div className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><p className="font-semibold">{fulfillmentTimeTitle(order)}</p>{order.fulfillmentTimeChangeReason ? <p className="mt-1 text-xs">原因：{order.fulfillmentTimeChangeReason}</p> : null}{order.fulfillmentTimeResponseExpiresAt && order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? <p className="mt-1 text-xs">顧客需於 {formatStaffFulfillmentTime(order.fulfillmentTimeResponseExpiresAt)} 前回覆。</p> : null}</div></div>{order.source !== "OFFLINE_POS" && ["WAITING_CONFIRMATION", "CONFIRMED"].includes(order.status) ? <div className="mt-3 flex flex-wrap gap-2 print:hidden">{order.fulfillmentTimeState === "REQUESTED" ? <button type="button" disabled={updatingOrderId === order.id} onClick={() => void actions.onUpdateFulfillmentTime(order, { operation: "CONFIRM_REQUESTED", version: order.fulfillmentTimeVersion })} className="min-h-9 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50">接受原時間</button> : null}<button type="button" disabled={updatingOrderId === order.id || !timeProposal.canOpen} onClick={() => timeProposal.open(order)} className="min-h-9 rounded-md border border-current px-3 text-xs font-semibold disabled:opacity-40">{order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? "修改提議" : "提出新時間"}</button></div> : null}</div> : null}
      {order.status === "WAITING_CONFIRMATION" ? <p className="mt-3 text-xs font-medium text-amber-800">確認後才可開始製作；逾時時間 {new Date(order.confirmationExpiresAt).toLocaleTimeString("zh-TW")}</p> : null}
      {order.status !== "WAITING_CONFIRMATION" ? <div className="mt-4 flex flex-wrap gap-2 print:hidden">{order.items.some((item) => item.status === "PENDING") && !fulfillmentTimeNeedsResponse(order.fulfillmentTimeState) && canTransitionOrderItem("PENDING", "PREPARING", role) ? <button type="button" disabled={updatingItemsOrderId === order.id || updatingItemId !== null} onClick={() => void actions.onUpdateAllItemStatuses(order.id, "PREPARING")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><Play className="h-4 w-4" />全部開始製作（{order.items.filter((item) => item.status === "PENDING").length}）</button> : null}{order.items.some((item) => item.status === "PREPARING") && canTransitionOrderItem("PREPARING", "READY", role) ? <button type="button" disabled={updatingItemsOrderId === order.id || updatingItemId !== null} onClick={() => void actions.onUpdateAllItemStatuses(order.id, "READY")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><CheckCheck className="h-4 w-4" />全部餐點完成（{order.items.filter((item) => item.status === "PREPARING").length}）</button> : null}{order.items.some((item) => item.status === "READY") && canTransitionOrderItem("READY", "SERVED", role) ? <button type="button" disabled={updatingItemsOrderId === order.id || updatingItemId !== null} onClick={() => void actions.onUpdateAllItemStatuses(order.id, "SERVED")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-800 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"><PackageCheck className="h-4 w-4" />全部標記已出餐（{order.items.filter((item) => item.status === "READY").length}）</button> : null}</div> : null}
      <ul className="mt-4 divide-y divide-stone-100 border-y border-stone-200 text-sm">{order.items.map((item) => { const selectable = order.source !== "OFFLINE_POS" && canSelectItem(item.status, order.status, role) && !(item.status === "PENDING" && fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)); return <li key={item.id} className="relative grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">{selectable ? <input type="checkbox" aria-label={`選取 ${order.orderNo} 的 ${item.name}`} checked={selectedItemIds.has(item.id)} onChange={(event) => actions.onToggleSelectedItem(item.id, event.target.checked)} className="absolute left-0 top-4 h-4 w-4 print:hidden" /> : null}<div className={`min-w-0 ${selectable ? "pl-7" : ""}`}><div className="flex justify-between gap-3"><span className="font-medium">{item.quantity} × {item.name}</span><span>{formatMoney(item.unitPrice * item.quantity, currency)}</span></div>{item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{item.noteOptions.map((noteOption) => `${noteOption.groupName}：${noteOption.optionName}${noteOption.priceDelta === 0 ? "" : ` (${noteOption.priceDelta > 0 ? "+" : ""}${formatMoney(noteOption.priceDelta, currency)})`}`).join("、")}</p> : null}{item.note ? <p className="mt-1 text-xs text-stone-600">備註：{item.note}</p> : null}<span className={`mt-1 inline-flex rounded px-2 py-0.5 text-xs font-semibold ${item.status === "SERVED" ? "bg-emerald-50 text-emerald-800" : item.status === "READY" ? "bg-blue-50 text-blue-800" : item.status === "PREPARING" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{orderItemStatusLabels[item.status]}</span></div>{order.source !== "OFFLINE_POS" && item.status !== "SERVED" && order.status !== "WAITING_CONFIRMATION" && !(item.status === "PENDING" && fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)) ? <ItemStatusButton itemStatus={item.status} role={role} busy={updatingItemId === item.id || updatingItemsOrderId === order.id} onUpdate={(status) => void actions.onUpdateItemStatus(order.id, item.id, status)} /> : null}</li>; })}</ul>
      {order.note ? <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{order.note}</p> : null}
      <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-4"><div>{order.discountAmount > 0 ? <div className="text-xs text-stone-500">原價 {formatMoney(order.subtotal, currency)} · {order.discountLabel}</div> : null}<strong>{formatMoney(order.total, currency)}</strong></div><span className="text-sm text-stone-600">{paymentStatusLabels[order.paymentStatus]}</span></div>
      {printEnabled && !order.isTest ? <button type="button" onClick={() => void actions.onPrintOrder(order.id)} className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-medium hover:bg-stone-100 print:hidden"><Printer className="h-4 w-4" />排入列印</button> : null}
      {order.status === "READY" && order.fulfillmentType === "TAKEOUT" && order.source === "QR_MENU" && hasPermission(role, "CHECKOUT_ORDERS") ? order.pickupVerifiedAt ? <div className="mt-4 flex items-center gap-2 text-sm font-medium text-teal-800"><CheckCircle2 className="h-4 w-4" />{order.pickupVerificationMethod === "MANUAL" ? "已完成人工取餐核對" : "取餐碼已驗證"}</div> : <div className="mt-4"><div className="relative"><input type="text" inputMode="numeric" autoComplete="one-time-code" aria-label={`${order.pickupCodeLength === 6 ? "六" : "三"}位數取餐碼`} aria-busy={verifyingPickupOrderId === order.id} disabled={verifyingPickupOrderId === order.id} maxLength={order.pickupCodeLength === 6 ? 6 : 3} pattern={order.pickupCodeLength === 6 ? "[0-9]{6}" : "[0-9]{3}"} value={pickupCode} onChange={(event) => actions.onPickupCodeChange(order.id, event.target.value)} className="h-11 w-full rounded-md border border-stone-300 px-3 pr-11 font-mono text-lg disabled:bg-stone-50" placeholder={`${order.pickupCodeLength === 6 ? "六" : "三"}位取餐碼`} />{verifyingPickupOrderId === order.id ? <span className="absolute inset-y-0 right-3 grid place-items-center text-teal-700" role="status"><LoaderCircle className="h-5 w-5 animate-spin" /><span className="sr-only">正在驗證取餐碼</span></span> : null}</div><button type="button" disabled={verifyingPickupOrderId === order.id} onClick={() => manualPickup.open(order.id)} className="mt-2 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-stone-700 hover:text-stone-950 disabled:opacity-50"><KeyRound className="h-4 w-4" />無法取得取餐碼</button></div> : null}
      <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">{staffStatusOptions.filter((option) => canTransitionOrder(order.status, option.value, role)).filter((option) => option.value !== "PREPARING" && option.value !== "READY").filter((option) => order.source !== "OFFLINE_POS" || option.value === "COMPLETED" || option.value === "CANCELLED").filter((option) => option.value !== "COMPLETED" || order.fulfillmentType === "DINE_IN" || order.source !== "QR_MENU" || Boolean(order.pickupVerifiedAt)).map((option) => <button key={option.value} type="button" disabled={updatingOrderId === order.id} aria-haspopup={option.value === "CANCELLED" ? "dialog" : undefined} onClick={() => { if (option.value === "CANCELLED") { cancellation.open({ id: order.id, orderNo: order.orderNo, customerName: order.customerName }); return; } if (option.value === "COMPLETED") { if (order.paymentStatus === "PAID") void actions.onUpdateOrder(order.id, "COMPLETED"); else void actions.onOpenCheckout(order); return; } void actions.onUpdateOrder(order.id, option.value); }} className={`rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${option.value === "CANCELLED" ? "border-red-300 text-red-700 hover:bg-red-50" : "border-stone-300 hover:bg-stone-100"}`}>{option.label}</button>)}</div>
    </article>
  );
}

function StaffPosComposerAndDialogs({ stall, account, modules, paymentOptions, discountOptions, orderCatalog, orders, composerOpen, updatingOrderId, verifyingPickupOrderId, message, cancellation, checkout, manualPickup, timeProposal, actions }: Pick<StaffOrderBoardPresentationProps, "stall" | "account" | "modules" | "paymentOptions" | "discountOptions" | "orderCatalog" | "orders" | "composerOpen" | "updatingOrderId" | "verifyingPickupOrderId" | "message" | "cancellation" | "checkout" | "manualPickup" | "timeProposal"> & { actions: Pick<Actions, "onCloseComposer" | "onCreated"> }) {
  return (
    <>
      {composerOpen && orderCatalog ? <StaffOrderComposer stall={stall} catalog={orderCatalog} account={account} modules={modules} paymentOptions={paymentOptions} discountOptions={discountOptions} discountSettingsHref={hasPermission(account.role, "MANAGE_STALL") ? `/merchant/stalls/${stall.id}/settings/modules?source=staff#discount-options` : undefined} onCreated={actions.onCreated} onClose={actions.onCloseComposer} /> : null}
      <StaffOrderCheckoutDialog controller={checkout} updatingOrderId={updatingOrderId} currency={stall.currency} discountSettingsHref={hasPermission(account.role, "MANAGE_STALL") ? `/merchant/stalls/${stall.id}/settings/modules?source=staff#discount-options` : undefined} cashShiftHref={`/staff/${stall.slug}/cash`} message={message} />
      <StaffOrderTimeProposalDialog controller={timeProposal} orders={orders} updatingOrderId={updatingOrderId} />
      <StaffOrderManualPickupDialog controller={manualPickup} orders={orders} verifyingPickupOrderId={verifyingPickupOrderId} />
      <StaffOrderCancellationDialog controller={cancellation} updatingOrderId={updatingOrderId} />
    </>
  );
}

function LiveConnectionBadge({ state }: { state: StaffOrderLiveConnectionState }) {
  const connected = state === "sse" || state === "realtime";
  const label = state === "sse" ? "SSE 即時" : state === "realtime" ? "Realtime 備援" : state === "polling" ? "5 秒輪詢" : "連線中";
  const title = state === "sse" ? "已連上授權 SSE，事件只觸發重新取得伺服器資料" : state === "realtime" ? "SSE 未就緒，已切換 Supabase Realtime 通知" : state === "polling" ? "SSE 與 Realtime 未就緒，已啟用 5 秒輪詢" : "正在建立即時更新連線";
  return <span role="status" className={`inline-flex h-10 items-center gap-1.5 text-xs font-medium ${connected ? "text-emerald-700" : "text-amber-700"}`} title={title}>{connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}<span className="hidden sm:inline">{label}</span></span>;
}

function ItemStatusButton({ itemStatus, role, busy, onUpdate }: { itemStatus: OrderItemStatus; role: UserRole; busy: boolean; onUpdate: (status: Exclude<OrderItemStatus, "PENDING">) => void }) {
  const nextStatus = nextOperationalItemStatus(itemStatus);
  if (!nextStatus || !canTransitionOrderItem(itemStatus, nextStatus, role)) return null;
  const labels = { PREPARING: "開始製作", READY: "餐點完成", SERVED: "標記已出餐" } as const;
  return <button type="button" disabled={busy} onClick={() => onUpdate(nextStatus)} className="min-h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 print:hidden">{busy ? "更新中…" : labels[nextStatus]}</button>;
}

export function nextOperationalItemStatus(status: OrderItemStatus) {
  return status === "PENDING" ? "PREPARING" as const : status === "PREPARING" ? "READY" as const : status === "READY" ? "SERVED" as const : null;
}

function canSelectItem(status: OrderItemStatus, orderStatus: OrderStatus, role: UserRole) {
  if (orderStatus === "WAITING_CONFIRMATION") return false;
  const next = nextOperationalItemStatus(status);
  return Boolean(next && canTransitionOrderItem(status, next, role));
}

export function fulfillmentTimeNeedsResponse(state: StaffOrderDto["fulfillmentTimeState"]) {
  return state === "REQUESTED" || state === "CUSTOMER_ACTION_REQUIRED";
}

function formatStaffFulfillmentTime(value: string) {
  return new Intl.DateTimeFormat("zh-TW", { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function fulfillmentTimeTitle(order: StaffOrderDto) {
  const label = order.fulfillmentType === "DELIVERY" ? "送達" : "取餐";
  if (order.fulfillmentTimeState === "REQUESTED" && order.requestedFulfillmentAt) return `顧客希望${label}：${formatStaffFulfillmentTime(order.requestedFulfillmentAt)}`;
  if (order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" && order.pendingFulfillmentAt) return `等待顧客確認新${label}時間：${formatStaffFulfillmentTime(order.pendingFulfillmentAt)}`;
  if (order.fulfillmentTimeState === "CONFIRMED" && order.committedFulfillmentAt) return `已確認${label}：${formatStaffFulfillmentTime(order.committedFulfillmentAt)}`;
  if (order.fulfillmentTimeState === "DECLINED") return order.committedFulfillmentAt ? `顧客未接受新時間，維持 ${formatStaffFulfillmentTime(order.committedFulfillmentAt)}` : "顧客未接受店員建議的時間";
  if (order.fulfillmentTimeState === "EXPIRED") return "顧客尚未在期限內回覆時間調整";
  return `${label}時間尚未確認`;
}

function batchActionLabel(status: "PREPARING" | "READY" | "SERVED") {
  return status === "PREPARING" ? "開始製作" : status === "READY" ? "餐點完成" : "標記已出餐";
}

function orderAgeMinutes(createdAt: string, now: number) {
  return Math.max(0, Math.floor((now - new Date(createdAt).getTime()) / 60_000));
}

function orderAgeClasses(createdAt: string, now: number) {
  const minutes = orderAgeMinutes(createdAt, now);
  if (minutes >= 20) return "border-red-300 bg-red-50";
  if (minutes >= 10) return "border-amber-300 bg-amber-50";
  return "border-stone-200 bg-white";
}
