"use client";

import type { OrderItemStatus, OrderStatus, UserRole } from "@prisma/client";
import Link from "next/link";
import {
  CheckCheck,
  CheckCircle2,
  ChefHat,
  ChevronDown,
  ChevronUp,
  Clock3,
  KeyRound,
  ListChecks,
  LoaderCircle,
  MapPinned,
  Minus,
  PackageCheck,
  Pencil,
  Play,
  Plus,
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
  X,
} from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { LogoutButton } from "@/components/logout-button";
import { OfflineBootstrapControl } from "@/components/offline-bootstrap-control";
import { OfflineQueueStatus } from "@/components/offline-queue-status";
import { PwaControls } from "@/components/pwa-controls";
import { StaffCapacityControl } from "@/components/staff-capacity-control";
import { StaffOrderComposer } from "@/components/staff-order-composer";
import type { StaffOrderUndoBatch } from "@/components/staff-order-board-batch";
import type { StaffOrderEditLine } from "@/components/staff-order-board-controller";
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
import type { AppLocale } from "@/lib/app-locale";
import type { FulfillmentProductionTiming } from "@/lib/fulfillment-time";
import { formatAppDateTime } from "@/lib/locale-format";
import { formatMoney } from "@/lib/money";
import { canTransitionOrderItem } from "@/lib/order-item-status";
import {
  staffStatusOptions,
  type StaffOrderDto,
} from "@/lib/orders";
import { canTransitionOrder, hasPermission } from "@/lib/rbac";
import type { WorkModeDestination } from "@/lib/work-mode";

type OperationsTranslator = ReturnType<typeof useOperationsLocale>["t"];
const staffFunctionTileClass = "inline-flex min-h-16 w-full min-w-0 flex-col items-center justify-center gap-1 rounded-md px-1 text-center text-[11px] font-semibold leading-tight sm:h-10 sm:min-h-10 sm:w-10 sm:flex-none sm:px-0";
const staffFunctionIconClass = "h-5 w-5 sm:h-4 sm:w-4";

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
  businessDayCutoffHour: number;
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
  onAddOrderEditProduct: () => void;
  onChangeOrderEditProduct: (productId: string) => void;
  onChangeOrderEditQuantity: (key: string, delta: number) => void;
  onCloseOrderEditor: () => void;
  onOpenOrderEditor: (order: StaffOrderDto) => void;
  onRemoveOrderEditLine: (key: string) => void;
  onSaveOrderEdit: () => Promise<void>;
  onToggleFutureOrders: () => void;
  onToggleOrderDetails: (orderId: string) => void;
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
  futureOrders: StaffOrderDto[];
  futureOrdersExpanded: boolean;
  futureUnpaidTotal: number;
  orderProductionTimings: Map<string, FulfillmentProductionTiming>;
  expandedOrderIds: ReadonlySet<string>;
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
  orderEditor: {
    editingOrder: StaffOrderDto | null;
    lines: StaffOrderEditLine[];
    products: NonNullable<StaffOrderPosSnapshot["catalog"]>["products"];
    selectedProductId: string;
    busy: boolean;
    message: string;
    editableOrderIds: ReadonlySet<string>;
  };
  actions: Actions;
};

export function StaffOrderBoardPresentation(props: StaffOrderBoardPresentationProps) {
  const { locale, t } = useOperationsLocale();
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
        t={t}
      />
      <StaffOrderBatchBars
        selectedItems={selectedItems}
        canUpdateSelection={props.canUpdateSelection}
        nextSelectedStatus={props.nextSelectedStatus}
        batchBusy={props.batchBusy}
        undoBatch={props.undoBatch}
        actions={actions}
        t={t}
      />
      {account.role === "KITCHEN" && viewMode === "SUMMARY" ? (
        <StaffKdsSummary
          groups={kitchenGroups}
          role={account.role}
          batchBusy={props.batchBusy}
          onUpdateSelectedItems={actions.onUpdateSelectedItems}
          t={t}
        />
      ) : viewMode === "TABLES" ? (
        <StaffTableGroups
          groups={diningTableGroups}
          currency={stall.currency}
          updatingOrderId={props.updatingOrderId}
          posConfigurationLoading={props.posConfigurationLoading}
          onOpenCheckout={actions.onOpenCheckout}
          onCompletePaidOrders={actions.onCompletePaidOrders}
          locale={locale}
          t={t}
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
          stall={stall}
          locale={locale}
          t={t}
          orderProductionTimings={props.orderProductionTimings}
          expandedOrderIds={props.expandedOrderIds}
          editableOrderIds={props.orderEditor.editableOrderIds}
        />
      )}
      {viewMode === "TICKETS" && filteredOrders.length === 0 ? (
        <p className="mt-10 text-center text-sm text-stone-500 print:hidden">
          {props.query ? t("staff.order.emptySearch") : t("staff.order.emptyToday")}
        </p>
      ) : null}
      {viewMode === "TICKETS" ? (
        <StaffFutureOrders
          orders={props.futureOrders}
          expanded={props.futureOrdersExpanded}
          unpaidTotal={props.futureUnpaidTotal}
          timings={props.orderProductionTimings}
          stall={stall}
          locale={locale}
          t={t}
          onToggle={actions.onToggleFutureOrders}
        />
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
        orderEditor={props.orderEditor}
        locale={locale}
        t={t}
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
  t: OperationsTranslator;
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
  t,
  actions,
}: StaffOrderBoardToolbarProps) {
  const role = account.role;
  return (
    <>
      <div className="flex min-w-0 max-w-full flex-col gap-3 print:hidden sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium text-teal-800">{t("staff.mobileBoard")}</p>
          <h1 className="text-2xl font-semibold sm:text-3xl">{stall.name}</h1>
          <p className="mt-1 text-xs text-stone-500">{account.displayName} · {roleLabel(role, t)}</p>
        </div>
        <div className="flex w-full min-w-0 max-w-full flex-col gap-2 sm:w-auto sm:items-end">
          <div className="flex max-w-full flex-wrap items-center gap-2 sm:justify-end">
            <WorkModeSwitcher destinations={workModeDestinations} currentMode="STAFF" organizationId={stall.organizationId} stallId={stall.id} offlineGuardStallId={stall.id} className="w-auto shrink-0" />
            <LiveConnectionBadge state={liveConnection} t={t} />
            <PwaControls showWakeLock />
          </div>
          <nav aria-label={t("staff.functions")} data-testid="staff-function-grid" className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto sm:max-w-full sm:flex-nowrap sm:justify-end">
            {orderCatalog && hasPermission(role, "CREATE_ORDERS") ? <button type="button" title={t("staff.action.createOrder")} disabled={posConfigurationLoading} onClick={() => void actions.onOpenComposer()} className={`${staffFunctionTileClass} bg-teal-800 text-white disabled:cursor-wait disabled:opacity-60`}><ShoppingCart className={staffFunctionIconClass} /><span className="sm:sr-only">{t("staff.action.createOrder")}</span></button> : null}
            {modules.dineIn ? <Link href={`/staff/${stall.slug}/floor`} title={t("staff.action.floor")} className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700`}><MapPinned className={staffFunctionIconClass} /><span className="sm:sr-only">{t("staff.action.floor")}</span></Link> : null}
            {modules.print && hasPermission(role, "MANAGE_PRINT_QUEUE") ? <Link href={`/staff/${stall.slug}/print`} title={t("staff.action.printQueue")} className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700`}><Printer className={staffFunctionIconClass} /><span className="sm:sr-only">{t("staff.action.printQueue")}</span></Link> : null}
            {hasPermission(role, "MANAGE_CASH_SHIFT") ? <Link href={`/staff/${stall.slug}/cash`} title={t("staff.action.cashShift")} className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700`}><WalletCards className={staffFunctionIconClass} /><span className="sm:sr-only">{t("staff.action.cashShift")}</span></Link> : null}
            <button type="button" role="switch" aria-checked={alertsEnabled} aria-label={alertsEnabled ? t("staff.action.notificationsOn") : t("staff.action.notificationsOff")} onClick={actions.onToggleAlerts} title={alertsEnabled ? t("staff.action.notificationsDisable") : t("staff.action.notificationsEnable")} className={`${staffFunctionTileClass} border ${alertsEnabled ? "border-teal-700 bg-teal-50 text-teal-800" : "border-stone-300 bg-white text-stone-600"}`}>{alertsEnabled ? <Volume2 className={staffFunctionIconClass} /> : <VolumeX className={staffFunctionIconClass} />}<span aria-hidden="true" className="sm:sr-only">{t("staff.action.notifications")}</span></button>
            <div data-testid="staff-function-offline" className={`${staffFunctionTileClass} relative border border-stone-300 bg-white text-stone-700 [&>div>button:first-child]:h-11 [&>div>button:first-child]:w-11 [&>div>button:first-child]:border-0 sm:[&>div>button:first-child]:h-10 sm:[&>div>button:first-child]:w-10`}><OfflineBootstrapControl stallId={stall.id} stallSlug={stall.slug} appVersion={appVersion} /><span className="sm:sr-only">{t("staff.action.offlineDevice")}</span></div>
            <button type="button" onClick={actions.onRefresh} title={t("common.refresh")} className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700`}><RefreshCw className={`${staffFunctionIconClass} ${isRefreshing ? "animate-spin" : ""}`} /><span className="sm:sr-only">{t("common.refresh")}</span></button>
            <div data-testid="staff-function-logout" className={`${staffFunctionTileClass} border border-stone-300 bg-white text-stone-700 [&>button]:h-11 [&>button]:w-11 [&>button]:border-0 sm:[&>button]:h-10 sm:[&>button]:w-10`}><LogoutButton offlineStallId={stall.id} /><span className="sm:sr-only">{t("staff.action.logout")}</span></div>
          </nav>
        </div>
      </div>
      <OfflineQueueStatus stallId={stall.id} stallSlug={stall.slug} onSynchronized={actions.onSynchronized} />
      {message ? <p role="status" className="mt-4 text-sm text-stone-700 print:hidden">{message}</p> : null}
      {capacity ? <StaffCapacityControl stallSlug={stall.slug} initialData={capacity} /> : null}
      <div className="mt-4 flex flex-col gap-2 sm:mt-5 sm:flex-row sm:items-center sm:justify-between sm:gap-3 print:hidden">
        <label className="relative block w-full sm:max-w-sm"><Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-400" /><span className="sr-only">{t("staff.search.label")}</span><input type="search" value={query} maxLength={120} onChange={(event) => actions.onQueryChange(event.target.value)} placeholder={t("staff.search.shortPlaceholder")} className="h-11 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-sm" /></label>
        {role === "KITCHEN" ? (
          <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label={t("staff.view.kitchenMode")}><button type="button" aria-pressed={viewMode === "TICKETS"} onClick={() => actions.onViewModeChange("TICKETS")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TICKETS" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("staff.view.ticket")}</button><button type="button" aria-pressed={viewMode === "SUMMARY"} onClick={() => actions.onViewModeChange("SUMMARY")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "SUMMARY" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("staff.view.itemSummary")}</button></div>
        ) : modules.dineIn ? (
          <div className="inline-grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label={t("staff.view.orderMode")}><button type="button" aria-pressed={viewMode === "TICKETS"} onClick={() => actions.onViewModeChange("TICKETS")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TICKETS" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("staff.view.individual")}</button><button type="button" aria-pressed={viewMode === "TABLES"} onClick={() => actions.onViewModeChange("TABLES")} className={`h-8 rounded px-3 text-xs font-semibold ${viewMode === "TABLES" ? "bg-stone-900 text-white" : "text-stone-600"}`}>{t("staff.view.combineTable")}</button></div>
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
  t,
  actions,
}: Pick<StaffOrderBoardPresentationProps, "selectedItems" | "canUpdateSelection" | "nextSelectedStatus" | "batchBusy" | "undoBatch"> & {
  t: OperationsTranslator;
  actions: Pick<Actions, "onClearSelectedItems" | "onUndoSelectedItems" | "onUpdateSelectedItems">;
}) {
  return (
    <>
      {selectedItems.length > 0 ? <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-y border-stone-200 bg-stone-50 px-3 py-3 print:hidden"><span className="text-sm font-semibold">{t("staff.selection.count", { count: selectedItems.length })}</span><div className="flex gap-2"><button type="button" onClick={actions.onClearSelectedItems} className="h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold">{t("staff.selection.clear")}</button><button type="button" disabled={!canUpdateSelection || batchBusy || !nextSelectedStatus} onClick={() => nextSelectedStatus && void actions.onUpdateSelectedItems(selectedItems.map((item) => item.id), nextSelectedStatus)} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><ListChecks className="h-4 w-4" />{nextSelectedStatus ? t("staff.selection.batch", { action: batchActionLabel(nextSelectedStatus, t) }) : t("staff.selection.sameStatus")}</button></div></div> : null}
      {undoBatch ? <div role="status" className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-3 text-sm text-amber-950 print:hidden"><span>{t("staff.selection.updated", { count: undoBatch.itemCount })}</span><button type="button" disabled={batchBusy} onClick={() => void actions.onUndoSelectedItems()} className="inline-flex h-9 shrink-0 items-center gap-2 rounded-md border border-amber-700 px-3 text-xs font-semibold"><Undo2 className="h-4 w-4" />{t("staff.selection.undo")}</button></div> : null}
    </>
  );
}

function StaffKdsSummary({ groups, role, batchBusy, onUpdateSelectedItems, t }: {
  groups: StaffOrderKitchenGroup[];
  role: UserRole;
  batchBusy: boolean;
  onUpdateSelectedItems: Actions["onUpdateSelectedItems"];
  t: OperationsTranslator;
}) {
  return <div className="mt-6 divide-y divide-stone-200 border-y border-stone-200 print:hidden">{groups.map((group) => {
    const nextStatus = nextOperationalItemStatus(group.status);
    const canUpdate = nextStatus && canTransitionOrderItem(group.status, nextStatus, role);
    return <article key={group.key} className="grid gap-3 py-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div><div className="flex flex-wrap items-center gap-2"><ChefHat className="h-4 w-4 text-teal-700" /><h2 className="font-semibold">{group.quantity} × {group.name}</h2><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{orderItemStatusLabel(group.status, t)}</span></div>{group.notes ? <p className="mt-1 text-xs text-teal-800">{group.notes}</p> : null}<p className="mt-2 text-xs text-stone-500">{t("staff.item.source", { orders: group.tickets.join(", ") })}</p></div>{canUpdate && nextStatus ? <button type="button" disabled={batchBusy} onClick={() => void onUpdateSelectedItems(group.itemIds, nextStatus)} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><ListChecks className="h-4 w-4" />{t("staff.item.all", { action: batchActionLabel(nextStatus, t) })}</button> : null}</article>;
  })}{groups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{t("staff.item.nonePending")}</p> : null}</div>;
}

function StaffTableGroups({ groups, currency, updatingOrderId, posConfigurationLoading, onOpenCheckout, onCompletePaidOrders, locale, t }: {
  groups: StaffOrderDiningTableGroup[];
  currency: string;
  updatingOrderId: string | null;
  posConfigurationLoading: boolean;
  onOpenCheckout: Actions["onOpenCheckout"];
  onCompletePaidOrders: Actions["onCompletePaidOrders"];
  locale: AppLocale;
  t: OperationsTranslator;
}) {
  return <div className="mt-6 grid gap-4 md:grid-cols-2 print:hidden">{groups.map((group) => {
    const allServed = group.orders.every((order) => order.items.every((item) => item.status === "SERVED"));
    const checkoutEligible = allServed && group.orders.every((order) => order.status === "READY");
    const unpaidOrders = group.orders.filter((order) => order.paymentStatus === "UNPAID");
    const pendingItems = group.orders.flatMap((order) => order.items).filter((item) => item.status !== "SERVED").length;
    return <article key={group.diningTableId} className="rounded-lg border border-stone-200 bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="text-lg font-semibold">{group.tableLabel}</h2><p className="mt-1 text-xs text-stone-500">{t("staff.table.summary", { orders: group.orders.length, items: group.orders.reduce((sum, order) => sum + order.items.reduce((count, item) => count + item.quantity, 0), 0) })}</p></div><strong>{formatMoney(group.orders.reduce((sum, order) => sum + order.total, 0), currency, locale)}</strong></div><div className="mt-4 divide-y divide-stone-100 border-y border-stone-200">{group.orders.map((order) => <div key={order.id} className="py-3"><div className="flex items-center justify-between gap-3 text-sm"><strong>{t("staff.order.number", { number: order.orderNo })}</strong><span className="rounded bg-stone-100 px-2 py-0.5 text-xs font-semibold">{contextualOrderStatusLabel(order, t)}</span></div><p className="mt-1 text-xs text-stone-600">{order.items.map((item) => `${item.quantity}×${item.name}`).join(", ")}</p><p className="mt-1 text-xs text-stone-500">{paymentStatusLabel(order.paymentStatus, t)}</p></div>)}</div><div className="mt-4 flex items-center justify-between gap-3"><span className={`text-xs font-semibold ${pendingItems === 0 ? "text-emerald-700" : "text-amber-800"}`}>{pendingItems === 0 ? t("staff.table.allServed") : t("staff.table.pendingItems", { count: pendingItems })}</span><button type="button" disabled={!checkoutEligible || updatingOrderId !== null || posConfigurationLoading} onClick={() => unpaidOrders.length > 0 ? void onOpenCheckout(unpaidOrders) : void onCompletePaidOrders(group.orders)} className="h-10 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-40">{unpaidOrders.length > 0 ? unpaidOrders.length > 1 ? t("staff.table.mergeCheckout", { count: unpaidOrders.length }) : t("staff.table.completeCheckout") : t("staff.table.complete")}</button></div></article>;
  })}{groups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500 md:col-span-2">{t("staff.table.empty")}</p> : null}</div>;
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
  | "orderProductionTimings"
  | "expandedOrderIds"
> & {
  orders: StaffOrderDto[];
  currency: string;
  role: UserRole;
  printEnabled: boolean;
  stall: Stall;
  locale: AppLocale;
  t: OperationsTranslator;
  editableOrderIds: ReadonlySet<string>;
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
    | "onOpenOrderEditor"
    | "onToggleOrderDetails"
  >;
};

function StaffTicketList(props: StaffTicketListProps) {
  return <div className="mt-6 grid gap-4 md:grid-cols-2 print:block"><div className="md:col-span-2 print:hidden"><h2 className="text-lg font-semibold">{props.t("staff.today.title")}</h2><p className="mt-1 text-sm text-stone-600">{props.t("staff.today.description")}</p></div>{props.orders.map((order) => <StaffOrderTicket key={order.id} {...props} order={order} pickupCode={props.pickupCodes[order.id] ?? ""} />)}</div>;
}

function StaffOrderTicket({ order, currency, role, printEnabled, now, selectedItemIds, pickupCode, updatingOrderId, updatingItemId, updatingItemsOrderId, verifyingPickupOrderId, cancellation, manualPickup, timeProposal, actions, stall, locale, t, orderProductionTimings, expandedOrderIds, editableOrderIds }: Omit<StaffTicketListProps, "orders" | "pickupCodes"> & { order: StaffOrderDto; pickupCode: string }) {
  const timing = orderProductionTimings.get(order.id);
  const expanded = expandedOrderIds.has(order.id);
  return (
    <article className={`rounded-lg border p-4 ${orderAgeClasses(order, timing, now)}`}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex flex-wrap items-center gap-2 text-xs font-semibold text-stone-500"><span>{t("staff.order.number", { number: order.orderNo })}</span>{order.isTest ? <span className="rounded bg-amber-100 px-2 py-0.5 text-amber-900">{t("staff.order.test")}</span> : null}{order.source === "OFFLINE_POS" ? <span className="rounded bg-blue-100 px-2 py-0.5 text-blue-900">{t("staff.order.localPending")}</span> : null}</div>
          <h2 className="mt-1 font-semibold">{order.customerName}</h2>
          <p className="mt-1 text-sm text-stone-500">{orderTimingSummary(order, timing, now, stall.timezone, locale, t)}</p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <span className="rounded-md bg-teal-50 px-2 py-1 text-xs font-semibold text-teal-800">{contextualOrderStatusLabel(order, t)}</span>
          <button type="button" aria-expanded={expanded} aria-controls={`order-details-${order.id}`} onClick={() => actions.onToggleOrderDetails(order.id)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-stone-300 px-2 text-xs font-semibold print:hidden">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
            {expanded ? t("staff.order.collapseShort") : t("staff.order.viewDetails")}
          </button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-stone-200 pt-3 print:hidden">
        <p className="text-sm text-stone-600">{t("common.portions", { count: order.items.reduce((sum, item) => sum + item.quantity, 0) })} · <strong className="text-stone-950">{formatMoney(order.total, currency, locale)}</strong> · {paymentStatusLabel(order.paymentStatus, t)}</p>
        <div className="flex flex-wrap gap-2">
          {editableOrderIds.has(order.id) ? <button type="button" onClick={() => actions.onOpenOrderEditor(order)} className="inline-flex min-h-9 items-center gap-1 rounded-md border border-stone-300 px-3 text-xs font-semibold"><Pencil className="h-4 w-4" />{t("staff.order.edit")}</button> : null}
          {order.status === "READY" && order.paymentStatus === "UNPAID" && hasPermission(role, "CHECKOUT_ORDERS") && (order.fulfillmentType !== "DINE_IN" || order.items.every((item) => item.status === "SERVED")) ? <button type="button" disabled={updatingOrderId === order.id} onClick={() => void actions.onOpenCheckout(order)} className="inline-flex min-h-9 items-center gap-1 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50"><WalletCards className="h-4 w-4" />{t("staff.order.checkoutForCustomer")}</button> : null}
        </div>
      </div>
      {!expanded ? <ul className="mt-3 space-y-2 rounded-md bg-stone-50 px-3 py-2.5 text-sm">
        {order.items.map((item) => <li key={item.id} className="min-w-0 break-words"><span className="font-medium">{item.quantity} × {item.name}</span>{item.noteOptions.length > 0 ? <span className="mt-0.5 block text-xs text-teal-800">{formatStaffNoteOptions(locale, item.noteOptions, currency, false)}</span> : null}{item.note ? <span className="mt-0.5 block text-xs text-stone-600">{t("staff.order.note", { note: item.note })}</span> : null}</li>)}
      </ul> : null}
      {order.fulfillmentType !== "DINE_IN" && order.fulfillmentTimeState !== "NOT_REQUESTED" ? <div className={`mt-3 rounded-md border px-3 py-3 text-sm ${order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? "border-amber-300 bg-amber-50 text-amber-950" : order.fulfillmentTimeState === "DECLINED" || order.fulfillmentTimeState === "EXPIRED" ? "border-red-200 bg-red-50 text-red-900" : "border-teal-200 bg-teal-50 text-teal-950"}`}><div className="flex items-start gap-2"><Clock3 className="mt-0.5 h-4 w-4 shrink-0" /><div className="min-w-0 flex-1"><p className="font-semibold">{fulfillmentTimeTitle(order, locale, t)}</p>{order.fulfillmentTimeChangeReason ? <p className="mt-1 text-xs">{t("staff.order.reason", { reason: order.fulfillmentTimeChangeReason })}</p> : null}{order.fulfillmentTimeResponseExpiresAt && order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? <p className="mt-1 text-xs">{t("staff.order.replyBy", { time: formatStaffFulfillmentTime(order.fulfillmentTimeResponseExpiresAt, locale) })}</p> : null}</div></div>{order.source !== "OFFLINE_POS" && ["WAITING_CONFIRMATION", "CONFIRMED"].includes(order.status) ? <div className="mt-3 flex flex-wrap gap-2 print:hidden">{order.fulfillmentTimeState === "REQUESTED" ? <button type="button" disabled={updatingOrderId === order.id} onClick={() => void actions.onUpdateFulfillmentTime(order, { operation: "CONFIRM_REQUESTED", version: order.fulfillmentTimeVersion })} className="min-h-9 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50">{t("staff.order.acceptOriginalTime")}</button> : null}<button type="button" disabled={updatingOrderId === order.id || !timeProposal.canOpen} onClick={() => timeProposal.open(order)} className="min-h-9 rounded-md border border-current px-3 text-xs font-semibold disabled:opacity-40">{order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" ? t("staff.order.editProposal") : t("staff.order.proposeTime")}</button></div> : null}</div> : null}
      {order.status === "WAITING_CONFIRMATION" ? <p className="mt-3 text-xs font-medium text-amber-800">{t("staff.order.confirmBeforeProduction", { time: formatAppDateTime(locale, order.confirmationExpiresAt, { timeStyle: "short", timeZone: stall.timezone }) })}</p> : null}
      <div className="mt-4 grid grid-cols-2 gap-2 print:hidden">{staffStatusOptions.filter((option) => canTransitionOrder(order.status, option.value, role)).filter((option) => option.value !== "PREPARING" && option.value !== "READY").filter((option) => order.source !== "OFFLINE_POS" || option.value === "COMPLETED" || option.value === "CANCELLED").filter((option) => option.value !== "COMPLETED" || order.fulfillmentType === "DINE_IN" || order.source !== "QR_MENU" || Boolean(order.pickupVerifiedAt)).map((option) => <button key={option.value} type="button" disabled={updatingOrderId === order.id} aria-haspopup={option.value === "CANCELLED" ? "dialog" : undefined} onClick={() => { if (option.value === "CANCELLED") { cancellation.open({ id: order.id, orderNo: order.orderNo, customerName: order.customerName }); return; } if (option.value === "COMPLETED") { if (order.paymentStatus === "PAID") void actions.onUpdateOrder(order.id, "COMPLETED"); else void actions.onOpenCheckout(order); return; } void actions.onUpdateOrder(order.id, option.value); }} className={`rounded-md border px-3 py-2 text-sm font-medium disabled:cursor-not-allowed disabled:opacity-50 ${option.value === "CANCELLED" ? "border-red-300 text-red-700 hover:bg-red-50" : "border-stone-300 hover:bg-stone-100"}`}>{option.value === "COMPLETED" && order.paymentStatus === "UNPAID" ? t("staff.order.checkoutForCustomer") : staffStatusActionLabel(option.value, t)}</button>)}</div>
      {expanded ? <div id={`order-details-${order.id}`}>
        {order.fulfillmentType === "DELIVERY" ? <div className="mt-3 flex items-start gap-2 border-y border-stone-200 bg-stone-50 px-3 py-3 text-sm"><Truck className="mt-0.5 h-4 w-4 shrink-0 text-teal-800" /><div className="min-w-0"><p className="font-medium break-words">{order.deliveryAddress || t("staff.delivery.noAddress")}</p>{order.customerPhone ? <p className="mt-1 text-stone-600">{order.customerPhone}</p> : <p className="mt-1 text-stone-500">{t("staff.delivery.noPhone")}</p>}</div></div> : null}
        {order.status !== "WAITING_CONFIRMATION" ? <div className="mt-4 flex flex-wrap gap-2 print:hidden">{order.items.some((item) => item.status === "PENDING") && !fulfillmentTimeNeedsResponse(order.fulfillmentTimeState) && canTransitionOrderItem("PENDING", "PREPARING", role) ? <button type="button" disabled={updatingItemsOrderId === order.id || updatingItemId !== null} onClick={() => void actions.onUpdateAllItemStatuses(order.id, "PREPARING")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-amber-700 px-3 text-xs font-semibold text-white disabled:opacity-50"><Play className="h-4 w-4" />{t("staff.order.allStart", { count: order.items.filter((item) => item.status === "PENDING").length })}</button> : null}{order.items.some((item) => item.status === "PREPARING") && canTransitionOrderItem("PREPARING", "READY", role) ? <button type="button" disabled={updatingItemsOrderId === order.id || updatingItemId !== null} onClick={() => void actions.onUpdateAllItemStatuses(order.id, "READY")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-50"><CheckCheck className="h-4 w-4" />{t("staff.order.allReady", { count: order.items.filter((item) => item.status === "PREPARING").length })}</button> : null}{order.items.some((item) => item.status === "READY") && canTransitionOrderItem("READY", "SERVED", role) ? <button type="button" disabled={updatingItemsOrderId === order.id || updatingItemId !== null} onClick={() => void actions.onUpdateAllItemStatuses(order.id, "SERVED")} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-emerald-800 px-3 text-xs font-semibold text-white disabled:opacity-50"><PackageCheck className="h-4 w-4" />{t(order.fulfillmentType === "DINE_IN" ? "staff.order.allServed" : order.fulfillmentType === "DELIVERY" ? "staff.order.allDelivered" : "staff.order.allPickedUp", { count: order.items.filter((item) => item.status === "READY").length })}</button> : null}</div> : null}
        <ul className="mt-4 divide-y divide-stone-100 border-y border-stone-200 text-sm">{order.items.map((item) => { const selectable = order.source !== "OFFLINE_POS" && canSelectItem(item.status, order.status, role) && !(item.status === "PENDING" && fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)); return <li key={item.id} className="relative grid gap-2 py-3 sm:grid-cols-[1fr_auto] sm:items-center">{selectable ? <input type="checkbox" aria-label={t("staff.order.selectItem", { order: order.orderNo, item: item.name })} checked={selectedItemIds.has(item.id)} onChange={(event) => actions.onToggleSelectedItem(item.id, event.target.checked)} className="absolute left-0 top-4 h-4 w-4 print:hidden" /> : null}<div className={`min-w-0 ${selectable ? "pl-7" : ""}`}><div className="flex justify-between gap-3"><span className="font-medium">{item.quantity} × {item.name}</span><span>{formatMoney(item.unitPrice * item.quantity, currency, locale)}</span></div>{item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{formatStaffNoteOptions(locale, item.noteOptions, currency, true)}</p> : null}{item.note ? <p className="mt-1 text-xs text-stone-600">{t("staff.order.note", { note: item.note })}</p> : null}<span className={`mt-1 inline-flex rounded px-2 py-0.5 text-xs font-semibold ${item.status === "SERVED" ? "bg-emerald-50 text-emerald-800" : item.status === "READY" ? "bg-blue-50 text-blue-800" : item.status === "PREPARING" ? "bg-amber-50 text-amber-800" : "bg-stone-100 text-stone-600"}`}>{orderItemStatusLabel(item.status, t)}</span></div>{order.source !== "OFFLINE_POS" && item.status !== "SERVED" && order.status !== "WAITING_CONFIRMATION" && !(item.status === "PENDING" && fulfillmentTimeNeedsResponse(order.fulfillmentTimeState)) ? <ItemStatusButton itemStatus={item.status} role={role} busy={updatingItemId === item.id || updatingItemsOrderId === order.id} t={t} onUpdate={(status) => void actions.onUpdateItemStatus(order.id, item.id, status)} /> : null}</li>; })}</ul>
        {order.note ? <p className="mt-4 rounded-md bg-amber-50 p-3 text-sm text-amber-900">{order.note}</p> : null}
        <div className="mt-4 flex items-center justify-between border-t border-stone-200 pt-4"><div>{order.discountAmount > 0 ? <div className="text-xs text-stone-500">{t("staff.order.originalPrice", { amount: formatMoney(order.subtotal, currency, locale) })} · {order.discountLabel}</div> : null}<strong>{formatMoney(order.total, currency, locale)}</strong></div><span className="text-sm text-stone-600">{paymentStatusLabel(order.paymentStatus, t)}</span></div>
        {printEnabled && !order.isTest ? <button type="button" onClick={() => void actions.onPrintOrder(order.id)} className="mt-3 inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-medium hover:bg-stone-100 print:hidden"><Printer className="h-4 w-4" />{t("staff.order.queuePrint")}</button> : null}
        {order.status === "READY" && order.fulfillmentType === "TAKEOUT" && order.source === "QR_MENU" && hasPermission(role, "CHECKOUT_ORDERS") ? order.pickupVerifiedAt ? <div className="mt-4 flex items-center gap-2 text-sm font-medium text-teal-800"><CheckCircle2 className="h-4 w-4" />{order.pickupVerificationMethod === "MANUAL" ? t("staff.pickup.manualVerified") : t("staff.pickup.codeVerified")}</div> : <div className="mt-4"><div className="relative"><input type="text" inputMode="numeric" autoComplete="one-time-code" aria-label={t("staff.pickup.codeLabel", { digits: order.pickupCodeLength })} aria-busy={verifyingPickupOrderId === order.id} disabled={verifyingPickupOrderId === order.id} maxLength={order.pickupCodeLength === 6 ? 6 : 3} pattern={order.pickupCodeLength === 6 ? "[0-9]{6}" : "[0-9]{3}"} value={pickupCode} onChange={(event) => actions.onPickupCodeChange(order.id, event.target.value)} className="h-11 w-full rounded-md border border-stone-300 px-3 pr-11 font-mono text-lg disabled:bg-stone-50" placeholder={t("staff.pickup.codePlaceholder", { digits: order.pickupCodeLength })} />{verifyingPickupOrderId === order.id ? <span className="absolute inset-y-0 right-3 grid place-items-center text-teal-700" role="status"><LoaderCircle className="h-5 w-5 animate-spin" /><span className="sr-only">{t("staff.pickup.verifying")}</span></span> : null}</div><button type="button" disabled={verifyingPickupOrderId === order.id} onClick={() => manualPickup.open(order.id)} className="mt-2 inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-stone-700 hover:text-stone-950 disabled:opacity-50"><KeyRound className="h-4 w-4" />{t("staff.pickup.unavailable")}</button></div> : null}
      </div> : null}
    </article>
  );
}

function StaffFutureOrders({
  orders,
  expanded,
  unpaidTotal,
  timings,
  stall,
  locale,
  t,
  onToggle,
}: {
  orders: StaffOrderDto[];
  expanded: boolean;
  unpaidTotal: number;
  timings: Map<string, FulfillmentProductionTiming>;
  stall: Stall;
  locale: AppLocale;
  t: OperationsTranslator;
  onToggle: () => void;
}) {
  if (orders.length === 0) return null;
  return (
    <section className="mt-6 rounded-lg border border-sky-200 bg-sky-50 print:hidden">
      <button type="button" aria-expanded={expanded} aria-controls="future-scheduled-orders" onClick={onToggle} className="flex min-h-16 w-full items-center justify-between gap-4 px-4 py-3 text-left">
        <div>
          <h2 className="font-semibold text-sky-950">{t("staff.future.countTitle", { count: orders.length })}</h2>
          <p className="mt-1 text-xs text-sky-800">{t("staff.future.description", { amount: formatMoney(unpaidTotal, stall.currency, locale) })}</p>
          <p className="mt-1 text-xs text-sky-700">{t("staff.future.dates", { dates: futureBusinessDateSummary(orders, timings, t) })}</p>
        </div>
        {expanded ? <ChevronUp className="h-5 w-5 shrink-0" /> : <ChevronDown className="h-5 w-5 shrink-0" />}
      </button>
      {expanded ? (
        <div id="future-scheduled-orders" className="grid gap-3 border-t border-sky-200 p-4 md:grid-cols-2">
          {orders.map((order) => {
            const timing = timings.get(order.id);
            return (
              <article key={order.id} className="rounded-md border border-sky-200 bg-white p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-semibold text-stone-500">{t("staff.order.number", { number: order.orderNo })}</p>
                    <h3 className="mt-1 font-semibold">{order.customerName}</h3>
                    <p className="mt-1 text-sm font-medium text-sky-900">{futureOrderTimeLabel(order, timing, stall.timezone, locale, t)}</p>
                  </div>
                  <span className="rounded bg-sky-100 px-2 py-1 text-xs font-semibold text-sky-900">{t("staff.future.notDue")}</span>
                </div>
                {order.fulfillmentType === "DELIVERY" ? <p className="mt-3 rounded bg-stone-50 px-3 py-2 text-sm">{t("staff.future.delivery", { details: `${order.deliveryAddress || t("staff.delivery.noAddress")}${order.customerPhone ? ` · ${order.customerPhone}` : ""}` })}</p> : null}
                <ul className="mt-3 divide-y divide-stone-100 border-y border-stone-200 text-sm">
                  {order.items.map((item) => <li key={item.id} className="py-2"><div className="flex justify-between gap-3"><span>{item.quantity} × {item.name}</span><span>{formatMoney(item.unitPrice * item.quantity, stall.currency, locale)}</span></div>{item.noteOptions.length > 0 ? <p className="mt-1 text-xs text-teal-800">{formatStaffNoteOptions(locale, item.noteOptions, stall.currency, false)}</p> : null}{item.note ? <p className="mt-1 text-xs text-stone-600">{t("staff.order.note", { note: item.note })}</p> : null}</li>)}
                </ul>
                {order.note ? <p className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">{t("staff.order.orderNote", { note: order.note })}</p> : null}
                <div className="mt-3 flex items-center justify-between"><strong>{formatMoney(order.total, stall.currency, locale)}</strong><span className="text-sm text-stone-600">{paymentStatusLabel(order.paymentStatus, t)}</span></div>
                <p className="mt-3 text-xs font-medium text-sky-800">{t("staff.future.noProductionAction")}</p>
              </article>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

function StaffPosComposerAndDialogs({ stall, account, modules, paymentOptions, discountOptions, orderCatalog, orders, composerOpen, updatingOrderId, verifyingPickupOrderId, message, cancellation, checkout, manualPickup, timeProposal, orderEditor, locale, t, actions }: Pick<StaffOrderBoardPresentationProps, "stall" | "account" | "modules" | "paymentOptions" | "discountOptions" | "orderCatalog" | "orders" | "composerOpen" | "updatingOrderId" | "verifyingPickupOrderId" | "message" | "cancellation" | "checkout" | "manualPickup" | "timeProposal" | "orderEditor"> & { locale: AppLocale; t: OperationsTranslator; actions: Pick<Actions, "onAddOrderEditProduct" | "onChangeOrderEditProduct" | "onChangeOrderEditQuantity" | "onCloseComposer" | "onCloseOrderEditor" | "onCreated" | "onRemoveOrderEditLine" | "onSaveOrderEdit"> }) {
  return (
    <>
      {composerOpen && orderCatalog ? <StaffOrderComposer stall={stall} catalog={orderCatalog} account={account} modules={modules} paymentOptions={paymentOptions} discountOptions={discountOptions} discountSettingsHref={hasPermission(account.role, "MANAGE_STALL") ? `/merchant/stalls/${stall.id}/settings/modules?source=staff#discount-options` : undefined} onCreated={actions.onCreated} onClose={actions.onCloseComposer} /> : null}
      {orderEditor.editingOrder && orderCatalog ? (
        <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4 print:hidden">
          <section role="dialog" aria-modal="true" aria-labelledby="order-edit-title" className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto overscroll-contain rounded-lg bg-white p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 id="order-edit-title" className="text-lg font-semibold">{t("staff.edit.title")}</h2>
                <p className="mt-1 text-sm text-stone-600">{t("staff.edit.description", { number: orderEditor.editingOrder.orderNo })}</p>
              </div>
              <button type="button" title={t("staff.edit.close")} disabled={orderEditor.busy} onClick={actions.onCloseOrderEditor} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-stone-300 disabled:opacity-50"><X className="h-4 w-4" /></button>
            </div>
            <div className="mt-5 divide-y divide-stone-100 border-y border-stone-200">
              {orderEditor.lines.map((line) => (
                <div key={line.key} className="grid gap-3 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><strong>{line.name}</strong>{line.kind === "NEW" ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-800">{t("staff.edit.new")}</span> : null}</div>
                    {line.kind === "EXISTING" && line.details ? <p className="mt-1 text-xs text-stone-600">{line.details}</p> : null}
                    <p className="mt-1 text-xs text-stone-500">{formatMoney(line.unitPrice, stall.currency, locale)} × {line.quantity} = {formatMoney(line.unitPrice * line.quantity, stall.currency, locale)}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <button type="button" aria-label={t("staff.edit.decrease", { item: line.name })} disabled={orderEditor.busy || line.quantity <= 1} onClick={() => actions.onChangeOrderEditQuantity(line.key, -1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                    <span className="w-8 text-center font-semibold">{line.quantity}</span>
                    <button type="button" aria-label={t("staff.edit.increase", { item: line.name })} disabled={orderEditor.busy || line.quantity >= 100} onClick={() => actions.onChangeOrderEditQuantity(line.key, 1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                    <button type="button" disabled={orderEditor.busy} onClick={() => actions.onRemoveOrderEditLine(line.key)} className="ml-1 min-h-9 rounded-md border border-red-300 px-3 text-xs font-semibold text-red-700 disabled:opacity-40">{t("composer.remove")}</button>
                  </div>
                </div>
              ))}
              {orderEditor.lines.length === 0 ? <p className="py-6 text-center text-sm text-red-700">{t("staff.edit.minOne")}</p> : null}
            </div>
            <div className="mt-5 rounded-md border border-stone-200 bg-stone-50 p-4">
              <label htmlFor="order-edit-product" className="text-xs font-semibold text-stone-700">{t("staff.edit.addProduct")}</label>
              <div className="mt-2 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
                <select id="order-edit-product" value={orderEditor.selectedProductId} onChange={(event) => actions.onChangeOrderEditProduct(event.target.value)} disabled={orderEditor.busy} className="h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3 text-sm disabled:opacity-50">
                  <option value="">{t("staff.edit.selectSimple")}</option>
                  {orderEditor.products.map((product) => <option key={product.id} value={product.id}>{product.name} · {formatMoney(product.price, stall.currency, locale)}</option>)}
                </select>
                <button type="button" disabled={orderEditor.busy || !orderEditor.selectedProductId} onClick={actions.onAddOrderEditProduct} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />{t("staff.edit.add")}</button>
              </div>
              <p className="mt-2 text-xs leading-5 text-stone-600">{t("staff.edit.customizationWarning")}</p>
            </div>
            {orderEditor.message ? <p role="alert" className="mt-4 rounded-md border border-red-300 bg-red-50 p-3 text-sm font-semibold text-red-900">{orderEditor.message}</p> : null}
            <div className="mt-5 flex items-center justify-between gap-4 border-t border-stone-200 pt-4">
              <div><p className="text-xs text-stone-500">{t("staff.edit.estimatedSubtotal")}</p><strong>{formatMoney(orderEditor.lines.reduce((sum, line) => sum + line.unitPrice * line.quantity, 0), stall.currency, locale)}</strong></div>
              <div className="flex gap-2">
                <button type="button" disabled={orderEditor.busy} onClick={actions.onCloseOrderEditor} className="min-h-10 rounded-md border border-stone-300 px-4 text-sm font-medium disabled:opacity-50">{t("common.back")}</button>
                <button type="button" disabled={orderEditor.busy || orderEditor.lines.length === 0} onClick={() => void actions.onSaveOrderEdit()} className="min-h-10 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40">{orderEditor.busy ? t("staff.edit.repricing") : t("staff.edit.save")}</button>
              </div>
            </div>
          </section>
        </div>
      ) : null}
      <StaffOrderCheckoutDialog controller={checkout} updatingOrderId={updatingOrderId} currency={stall.currency} discountSettingsHref={hasPermission(account.role, "MANAGE_STALL") ? `/merchant/stalls/${stall.id}/settings/modules?source=staff#discount-options` : undefined} cashShiftHref={`/staff/${stall.slug}/cash`} message={message} />
      <StaffOrderTimeProposalDialog controller={timeProposal} orders={orders} updatingOrderId={updatingOrderId} />
      <StaffOrderManualPickupDialog controller={manualPickup} orders={orders} verifyingPickupOrderId={verifyingPickupOrderId} />
      <StaffOrderCancellationDialog controller={cancellation} updatingOrderId={updatingOrderId} />
    </>
  );
}

function LiveConnectionBadge({ state, t }: { state: StaffOrderLiveConnectionState; t: OperationsTranslator }) {
  const connected = state === "sse" || state === "realtime";
  const label = state === "sse"
    ? t("staff.live.sse")
    : state === "realtime"
      ? t("staff.live.realtime")
      : state === "polling"
        ? t("staff.live.polling")
        : t("staff.live.connecting");
  const title = state === "sse"
    ? t("staff.live.sseTitle")
    : state === "realtime"
      ? t("staff.live.realtimeTitle")
      : state === "polling"
        ? t("staff.live.pollingTitle")
        : t("staff.live.connectingTitle");
  return <span role="status" className={`inline-flex h-10 items-center gap-1.5 text-xs font-medium ${connected ? "text-emerald-700" : "text-amber-700"}`} title={title}>{connected ? <Wifi className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}<span className="hidden sm:inline">{label}</span></span>;
}

function ItemStatusButton({ itemStatus, role, busy, t, onUpdate }: { itemStatus: OrderItemStatus; role: UserRole; busy: boolean; t: OperationsTranslator; onUpdate: (status: Exclude<OrderItemStatus, "PENDING">) => void }) {
  const nextStatus = nextOperationalItemStatus(itemStatus);
  if (!nextStatus || !canTransitionOrderItem(itemStatus, nextStatus, role)) return null;
  return <button type="button" disabled={busy} onClick={() => onUpdate(nextStatus)} className="min-h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 print:hidden">{busy ? t("staff.action.updating") : batchActionLabel(nextStatus, t)}</button>;
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

function formatStaffFulfillmentTime(value: string, locale: AppLocale) {
  return formatAppDateTime(locale, value, { month: "numeric", day: "numeric", weekday: "short", hour: "2-digit", minute: "2-digit" });
}

function fulfillmentTimeTitle(order: StaffOrderDto, locale: AppLocale, t: OperationsTranslator) {
  const kind = order.fulfillmentType === "DELIVERY" ? t("staff.fulfillment.delivery") : t("staff.fulfillment.pickup");
  if (order.fulfillmentTimeState === "REQUESTED" && order.requestedFulfillmentAt) return t("staff.fulfillment.customerRequested", { kind, time: formatStaffFulfillmentTime(order.requestedFulfillmentAt, locale) });
  if (order.fulfillmentTimeState === "CUSTOMER_ACTION_REQUIRED" && order.pendingFulfillmentAt) return t("staff.fulfillment.waitingCustomer", { kind, time: formatStaffFulfillmentTime(order.pendingFulfillmentAt, locale) });
  if (order.fulfillmentTimeState === "CONFIRMED" && order.committedFulfillmentAt) return t("staff.fulfillment.confirmed", { kind, time: formatStaffFulfillmentTime(order.committedFulfillmentAt, locale) });
  if (order.fulfillmentTimeState === "DECLINED") return order.committedFulfillmentAt ? t("staff.fulfillment.kept", { time: formatStaffFulfillmentTime(order.committedFulfillmentAt, locale) }) : t("staff.fulfillment.rejected");
  if (order.fulfillmentTimeState === "EXPIRED") return t("staff.fulfillment.expired");
  return t("staff.fulfillment.unconfirmed", { kind });
}

function batchActionLabel(status: "PREPARING" | "READY" | "SERVED", t: OperationsTranslator) {
  return status === "PREPARING" ? t("staff.action.startPreparing") : status === "READY" ? t("staff.action.markReady") : t("staff.action.markServed");
}

function orderItemStatusLabel(status: OrderItemStatus, t: OperationsTranslator) {
  return t(status === "PENDING" ? "staff.item.pending" : status === "PREPARING" ? "staff.item.preparing" : status === "READY" ? "staff.item.ready" : status === "SERVED" ? "staff.item.served" : "staff.item.cancelled");
}

function roleLabel(role: UserRole, t: OperationsTranslator) {
  return t(role === "ORGANIZATION_OWNER" || role === "MERCHANT_OWNER" ? "staff.role.owner" : role === "STALL_MANAGER" || role === "MERCHANT_MANAGER" ? "staff.role.manager" : role === "KITCHEN" ? "staff.role.kitchen" : role === "FINANCE_VIEWER" ? "staff.role.finance" : role === "STAFF" ? "staff.role.staff" : "staff.role.admin");
}

function paymentStatusLabel(status: StaffOrderDto["paymentStatus"], t: OperationsTranslator) {
  return t(status === "UNPAID" ? "staff.payment.unpaid" : status === "PENDING_RECONCILIATION" ? "staff.payment.reconciliation" : status === "PAID" ? "staff.payment.paid" : "staff.payment.refunded");
}

function orderStatusLabel(status: OrderStatus, t: OperationsTranslator) {
  return t(status === "WAITING_CONFIRMATION" ? "staff.status.waiting" : status === "CONFIRMED" ? "staff.status.confirmed" : status === "PREPARING" ? "staff.status.preparing" : status === "PACKING" ? "staff.status.packing" : status === "READY" ? "staff.status.ready" : status === "COMPLETED" ? "staff.status.completed" : status === "CANCELLED" ? "staff.status.cancelled" : "staff.status.expired");
}

function contextualOrderStatusLabel(order: Pick<StaffOrderDto, "status" | "source" | "paymentStatus" | "fulfillmentType">, t: OperationsTranslator) {
  if (order.status !== "READY" || order.source === "QR_MENU") return orderStatusLabel(order.status, t);
  if (order.fulfillmentType === "DINE_IN") return t("staff.status.awaitingService");
  if (order.source === "STAFF_POS" && order.paymentStatus === "UNPAID") return t("staff.status.awaitingCheckout");
  if (order.fulfillmentType === "DELIVERY" && order.paymentStatus === "PAID") return t("staff.status.awaitingDelivery");
  if (order.fulfillmentType === "TAKEOUT" && order.paymentStatus === "PAID") return t("staff.status.awaitingPickup");
  return orderStatusLabel(order.status, t);
}

function staffStatusActionLabel(status: (typeof staffStatusOptions)[number]["value"], t: OperationsTranslator) {
  return status === "CONFIRMED" ? t("staff.action.confirmOrder") : status === "PREPARING" ? t("staff.action.startPreparing") : status === "PACKING" ? t("staff.status.packing") : status === "READY" ? t("staff.action.markReady") : status === "COMPLETED" ? t("staff.checkout.completeOrder") : t("staff.cancel.confirm");
}

function orderAgeMinutes(order: StaffOrderDto, timing: FulfillmentProductionTiming | undefined, now: number) {
  const anchor = timing?.effectiveFulfillmentAt?.getTime() ?? new Date(order.createdAt).getTime();
  return Math.max(0, Math.floor((now - anchor) / 60_000));
}

function orderAgeClasses(order: StaffOrderDto, timing: FulfillmentProductionTiming | undefined, now: number) {
  const minutes = orderAgeMinutes(order, timing, now);
  if (minutes >= 20) return "border-red-300 bg-red-50";
  if (minutes >= 10) return "border-amber-300 bg-amber-50";
  return "border-stone-200 bg-white";
}

function orderTimingSummary(order: StaffOrderDto, timing: FulfillmentProductionTiming | undefined, now: number, timeZone: string, locale: AppLocale, t: OperationsTranslator) {
  const fulfillment = order.fulfillmentType === "DINE_IN" ? t("staff.timing.dineIn", { table: order.tableLabel ?? t("staff.table.unassigned") }) : order.fulfillmentType === "DELIVERY" ? t("staff.timing.deliveryOrder") : t("staff.timing.takeout");
  if (timing?.effectiveFulfillmentAt) {
    const label = order.fulfillmentType === "DELIVERY" ? t("staff.timing.scheduledDelivery") : t("staff.timing.scheduledPickup");
    const deltaMs = timing.effectiveFulfillmentAt.getTime() - now;
    const relative = deltaMs > 0 ? t("staff.timing.until", { minutes: Math.ceil(deltaMs / 60_000) }) : t("staff.timing.overdue", { minutes: Math.max(0, Math.floor(-deltaMs / 60_000)) });
    return `${fulfillment} · ${label} ${formatZonedDateTime(timing.effectiveFulfillmentAt, timeZone, locale)} · ${relative}`;
  }
  return t("staff.timing.orderedWait", { fulfillment, time: formatZonedDateTime(new Date(order.createdAt), timeZone, locale, false), minutes: orderAgeMinutes(order, timing, now) });
}

function futureOrderTimeLabel(order: StaffOrderDto, timing: FulfillmentProductionTiming | undefined, timeZone: string, locale: AppLocale, t: OperationsTranslator) {
  const label = order.fulfillmentType === "DELIVERY" ? t("staff.timing.scheduledDelivery") : t("staff.timing.scheduledPickup");
  return timing?.effectiveFulfillmentAt ? `${label}: ${formatZonedDateTime(timing.effectiveFulfillmentAt, timeZone, locale)}` : t("staff.future.pendingTime", { label });
}

function futureBusinessDateSummary(orders: StaffOrderDto[], timings: Map<string, FulfillmentProductionTiming>, t: OperationsTranslator) {
  const counts = new Map<string, number>();
  for (const order of orders) {
    const date = timings.get(order.id)?.fulfillmentBusinessDate ?? t("staff.future.unknownDate");
    counts.set(date, (counts.get(date) ?? 0) + 1);
  }
  return [...counts.entries()].map(([date, count]) => t("staff.future.dateCount", { date, count })).join(", ");
}

function formatZonedDateTime(value: Date, timeZone: string, locale: AppLocale, includeDate = true) {
  return formatAppDateTime(locale, value, { timeZone, ...(includeDate ? { month: "numeric", day: "numeric" } : {}), hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
}

function formatStaffNoteOptions(locale: AppLocale, noteOptions: Array<{ groupName: string; optionName: string; priceDelta: number }>, currency: string, includePrice: boolean) {
  const usesCjkPunctuation = locale === "zh-TW" || locale === "ja";
  const pairSeparator = usesCjkPunctuation ? "：" : ": ";
  const optionSeparator = usesCjkPunctuation ? "、" : ", ";
  return noteOptions.map((option) => {
    const price = includePrice && option.priceDelta !== 0 ? ` (${option.priceDelta > 0 ? "+" : ""}${formatMoney(option.priceDelta, currency, locale)})` : "";
    return `${option.groupName}${pairSeparator}${option.optionName}${price}`;
  }).join(optionSeparator);
}
