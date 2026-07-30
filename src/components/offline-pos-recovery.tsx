"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ChefHat,
  CircleAlert,
  Cloud,
  Printer,
  RefreshCw,
  ShoppingCart,
  WifiOff,
  XCircle,
} from "lucide-react";
import Link from "next/link";
import { OfflineQueueStatus } from "@/components/offline-queue-status";
import { StaffOrderComposer } from "@/components/staff-order-composer";
import { usePwaRuntime } from "@/components/pwa-runtime";
import { formatMoney } from "@/lib/money";
import type { OfflineOrder, OfflineOrderState } from "@/offline/offline-order-contract";
import {
  getOfflineRecoveryWorkspaces,
  listUnsynchronizedOfflineOrders,
  queueOfflinePrintJob,
  transitionOfflineOrder,
  type OfflineRecoveryWorkspace,
} from "@/offline/offline-operations";

const statusLabels: Record<OfflineOrderState, string> = {
  LOCAL_NEW: "本機新訂單",
  LOCAL_CONFIRMED: "等待製作",
  LOCAL_PREPARING: "製作中",
  LOCAL_READY: "可取餐",
  LOCAL_COMPLETED: "已完成",
  LOCAL_CANCELLED: "已取消",
};

export function OfflinePosRecovery() {
  const { online } = usePwaRuntime();
  const [workspaces, setWorkspaces] = useState<OfflineRecoveryWorkspace[]>([]);
  const [selectedStallId, setSelectedStallId] = useState("");
  const [orders, setOrders] = useState<OfflineOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [composerOpen, setComposerOpen] = useState(false);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [clockMs, setClockMs] = useState<number | null>(null);

  const workspace = useMemo(
    () => workspaces.find((candidate) => candidate.stall.id === selectedStallId) ?? null,
    [selectedStallId, workspaces],
  );

  const refresh = useCallback(async () => {
    try {
      const nextWorkspaces = await getOfflineRecoveryWorkspaces();
      setWorkspaces(nextWorkspaces);
      setSelectedStallId((current) => (
        nextWorkspaces.some((candidate) => candidate.stall.id === current)
          ? current
          : nextWorkspaces[0]?.stall.id ?? ""
      ));
    } catch {
      setWorkspaces([]);
      setSelectedStallId("");
      setMessage("此瀏覽器無法讀取離線營運資料。");
    } finally {
      setLoading(false);
    }
  }, []);

  const refreshOrders = useCallback(async () => {
    if (!selectedStallId) {
      setOrders([]);
      return;
    }
    try {
      setOrders(await listUnsynchronizedOfflineOrders(selectedStallId));
    } catch {
      setOrders([]);
      setMessage("本機訂單讀取失敗，請勿清除瀏覽器資料。");
    }
  }, [selectedStallId]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refresh(), 0);
    const onDataChanged = () => {
      void refresh();
      void refreshOrders();
    };
    window.addEventListener("stallorder:offline-data-changed", onDataChanged);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("stallorder:offline-data-changed", onDataChanged);
    };
  }, [refresh, refreshOrders]);

  useEffect(() => {
    const initialRefresh = window.setTimeout(() => void refreshOrders(), 0);
    return () => window.clearTimeout(initialRefresh);
  }, [refreshOrders]);

  useEffect(() => {
    const updateClock = () => setClockMs(Date.now());
    const initialTick = window.setTimeout(updateClock, 0);
    const timer = window.setInterval(updateClock, 60_000);
    return () => {
      window.clearTimeout(initialTick);
      window.clearInterval(timer);
    };
  }, []);

  async function transition(
    order: OfflineOrder,
    nextState: OfflineOrderState,
    reason: string | null = null,
  ) {
    if (
      nextState === "LOCAL_CANCELLED"
      && !window.confirm(`確定要取消本機訂單 ${order.localDisplayNumber}？取消後無法復原。`)
    ) {
      return;
    }
    setBusyOrderId(order.offlineOrderId);
    setMessage("");
    try {
      await transitionOfflineOrder(order.offlineOrderId, nextState, reason);
      await refreshOrders();
    } catch {
      setMessage("訂單狀態無法更新；資料仍保留於本機，請重新整理後再試。");
    } finally {
      setBusyOrderId(null);
    }
  }

  async function queuePrint(order: OfflineOrder) {
    setBusyOrderId(order.offlineOrderId);
    setMessage("");
    try {
      await queueOfflinePrintJob(order.offlineOrderId);
      setMessage(`${order.localDisplayNumber} 已加入本機列印佇列。`);
    } catch {
      setMessage("目前無法加入列印佇列；訂單資料未受影響。");
    } finally {
      setBusyOrderId(null);
    }
  }

  function onOrderCreated() {
    setComposerOpen(false);
    setMessage("本機訂單已建立，恢復連線後會以相同冪等鍵安全同步。");
    void refreshOrders();
  }

  if (loading) {
    return (
      <main className="mx-auto min-h-screen max-w-6xl px-4 py-8 sm:px-6">
        <p className="flex items-center gap-2 text-sm text-stone-600">
          <RefreshCw className="h-4 w-4 animate-spin" />
          正在讀取本機營運資料…
        </p>
      </main>
    );
  }

  if (!workspace) {
    return (
      <main className="mx-auto grid min-h-screen max-w-xl place-items-center px-5 py-10">
        <section className="w-full border-y border-stone-200 py-10 text-center">
          <WifiOff className="mx-auto h-10 w-10 text-amber-700" aria-hidden="true" />
          <h1 className="mt-5 text-2xl font-semibold">目前沒有可用的離線資料</h1>
          <p className="mt-3 text-sm leading-6 text-stone-600">
            請先在線上進入店員介面，由管理者核准此裝置並完成離線資料初始化。
          </p>
          <Link href="/login" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white">
            <RefreshCw className="h-4 w-4" aria-hidden="true" />
            恢復連線並登入
          </Link>
        </section>
      </main>
    );
  }

  const permitExpired = clockMs !== null
    && Date.parse(workspace.permitExpiresAt) <= clockMs;
  const menuExpired = clockMs !== null
    && Date.parse(workspace.menuExpiresAt) <= clockMs;

  return (
    <main className="mx-auto min-h-screen max-w-6xl px-4 py-5 sm:px-6">
      <header className="flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-semibold text-teal-800">
            <ChefHat className="h-5 w-5" />
            攤點通離線營運
          </p>
          <h1 className="mt-1 text-2xl font-semibold">{workspace.stall.name}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className={`inline-flex min-h-10 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${
            online
              ? "border-emerald-300 bg-emerald-50 text-emerald-900"
              : "border-amber-300 bg-amber-50 text-amber-950"
          }`}>
            {online ? <Cloud className="h-4 w-4" /> : <WifiOff className="h-4 w-4" />}
            {online ? "網路已恢復" : "目前離線"}
          </span>
          {online ? (
            <Link
              href={`/staff/${workspace.stall.slug}`}
              className="inline-flex min-h-10 items-center rounded-md bg-stone-900 px-3 text-sm font-semibold text-white"
            >
              返回店員介面
            </Link>
          ) : null}
        </div>
      </header>

      {workspaces.length > 1 ? (
        <label className="mt-5 block max-w-sm text-sm font-semibold">
          離線攤位
          <select
            value={selectedStallId}
            onChange={(event) => setSelectedStallId(event.target.value)}
            className="form-input mt-1"
          >
            {workspaces.map((candidate) => (
              <option key={candidate.stall.id} value={candidate.stall.id}>
                {candidate.stall.name}
              </option>
            ))}
          </select>
        </label>
      ) : null}

      <OfflineQueueStatus
        stallId={workspace.stall.id}
        stallSlug={workspace.stall.slug}
        onSynchronized={() => void refreshOrders()}
      />

      {permitExpired || menuExpired ? (
        <section className="mt-4 flex gap-3 border-y border-red-300 bg-red-50 px-3 py-3 text-sm text-red-950">
          <CircleAlert className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">
              {permitExpired ? "離線授權已到期" : "離線菜單已到期"}
            </p>
            <p className="mt-1 text-xs leading-5">
              既有未同步資料仍保留，但不可建立新訂單；請恢復連線後重新初始化。
            </p>
          </div>
        </section>
      ) : null}

      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-semibold">本機待同步訂單</h2>
            <p className="mt-1 text-sm text-stone-600">
              重新載入或關閉後再開啟，資料仍保留於此裝置。
            </p>
          </div>
          <button
            type="button"
            disabled={!workspace.canCreateOrder}
            onClick={() => setComposerOpen(true)}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40"
          >
            <ShoppingCart className="h-4 w-4" />
            新增現場訂單
          </button>
        </div>

        {message ? (
          <p role="status" className="mt-4 border-y border-stone-200 py-3 text-sm text-stone-700">
            {message}
          </p>
        ) : null}

        <div className="mt-5 grid gap-4 lg:grid-cols-2">
          {orders.map((order) => (
            <article
              key={order.offlineOrderId}
              data-testid="offline-order-card"
              className="rounded-md border border-stone-300 bg-white p-4"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p data-testid="offline-order-number" className="font-mono text-xs text-stone-500">
                    {order.localDisplayNumber}
                  </p>
                  <h3 className="mt-1 text-lg font-semibold">{statusLabels[order.orderStatus]}</h3>
                  <p className="mt-1 text-sm text-stone-700">
                    {order.customerLabel || "現場顧客"}
                  </p>
                  <p className="mt-1 text-xs text-stone-500">
                    {new Date(order.createdAtDevice).toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}
                  </p>
                </div>
                <strong>{formatMoney(order.total, order.currency)}</strong>
              </div>
              <ul className="mt-4 divide-y divide-stone-100 border-y border-stone-200">
                {order.itemsSnapshot.map((item) => (
                  <li key={item.localItemId} className="py-2 text-sm">
                    <div className="flex justify-between gap-3">
                      <span>{item.quantity} × {item.name}</span>
                      <span>{formatMoney(item.unitPrice * item.quantity, order.currency)}</span>
                    </div>
                    {item.noteOptions.length > 0 ? (
                      <p className="mt-1 text-xs text-teal-800">
                        {item.noteOptions.map((option) => option.optionName).join("、")}
                      </p>
                    ) : null}
                  </li>
                ))}
              </ul>
              <div className="mt-4 flex flex-wrap gap-2">
                {order.orderStatus === "LOCAL_CONFIRMED" ? (
                  <button
                    type="button"
                    disabled={busyOrderId === order.offlineOrderId}
                    onClick={() => void transition(order, "LOCAL_PREPARING")}
                    className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white"
                  >
                    <ChefHat className="h-4 w-4" />
                    開始製作
                  </button>
                ) : null}
                {order.orderStatus === "LOCAL_CONFIRMED" || order.orderStatus === "LOCAL_PREPARING" ? (
                  <button
                    type="button"
                    disabled={busyOrderId === order.offlineOrderId}
                    onClick={() => void transition(order, "LOCAL_READY")}
                    className="min-h-10 rounded-md border border-teal-700 bg-teal-50 px-3 text-sm font-semibold text-teal-900"
                  >
                    餐點完成
                  </button>
                ) : null}
                {order.orderStatus === "LOCAL_READY" ? (
                  <button
                    type="button"
                    disabled={busyOrderId === order.offlineOrderId || order.paymentStatus === "UNPAID"}
                    onClick={() => void transition(order, "LOCAL_COMPLETED")}
                    className="min-h-10 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white disabled:opacity-40"
                  >
                    完成訂單
                  </button>
                ) : null}
                {workspace.modules.print && !["LOCAL_COMPLETED", "LOCAL_CANCELLED"].includes(order.orderStatus) ? (
                  <button
                    type="button"
                    title="加入本機列印佇列"
                    disabled={busyOrderId === order.offlineOrderId}
                    onClick={() => void queuePrint(order)}
                    className="grid h-10 w-10 place-items-center rounded-md border border-stone-300"
                  >
                    <Printer className="h-4 w-4" />
                  </button>
                ) : null}
                {!["LOCAL_COMPLETED", "LOCAL_CANCELLED"].includes(order.orderStatus) ? (
                  <button
                    type="button"
                    title="取消本機訂單"
                    disabled={busyOrderId === order.offlineOrderId}
                    onClick={() => void transition(order, "LOCAL_CANCELLED", "店員於離線營運頁取消")}
                    className="grid h-10 w-10 place-items-center rounded-md border border-red-300 text-red-700"
                  >
                    <XCircle className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            </article>
          ))}
        </div>
        {orders.length === 0 ? (
          <p className="mt-5 border-y border-stone-200 py-10 text-center text-sm text-stone-500">
            目前沒有待同步的本機訂單。
          </p>
        ) : null}
      </section>

      {composerOpen ? (
        <StaffOrderComposer
          stall={workspace.stall}
          catalog={workspace.catalog}
          account={workspace.account}
          modules={workspace.modules}
          paymentOptions={workspace.paymentOptions}
          discountOptions={[]}
          onCreated={onOrderCreated}
          onClose={() => setComposerOpen(false)}
        />
      ) : null}
    </main>
  );
}
