"use client";

import { useCallback, useState } from "react";
import type { CancellationReason, PaymentOptionKind } from "@prisma/client";
import { ChevronDown, ChevronUp, History, Printer, Search, ShieldCheck } from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { readApiJson } from "@/lib/api-response";
import { cancellationReasonOptions } from "@/lib/cancellation-reasons";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatAppDateTime } from "@/lib/locale-format";
import type { OperationsMessageKey } from "@/lib/messages/operations";
import { formatMoney } from "@/lib/money";

type CompletedOrder = {
  id: string;
  orderNo: string;
  customerName: string;
  customerPhone: string | null;
  fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
  tableLabel: string | null;
  status: "COMPLETED" | "CANCELLED";
  paymentStatus: "UNPAID" | "PENDING_RECONCILIATION" | "PAID" | "REFUNDED";
  subtotal: number;
  discountAmount: number;
  discountLabel: string | null;
  total: number;
  note: string | null;
  createdAt: string;
  completedAt: string | null;
  cancelledAt: string | null;
  cancellationReason: CancellationReason | null;
  cancellationDetail: string | null;
  payment: {
    id: string;
    paymentOptionId: string | null;
    checkoutGroupId: string | null;
    method: "CASH" | "OTHER";
    methodLabel: string;
    status: "UNPAID" | "PENDING_RECONCILIATION" | "PAID" | "REFUNDED";
    amount: number;
    paidAt: string;
  } | null;
  items: Array<{
    id: string;
    name: string;
    quantity: number;
    unitPrice: number;
    note: string | null;
    noteOptions: Array<{ groupName: string; optionName: string; priceDelta: number }>;
  }>;
};

type PaymentOption = { id: string; name: string; kind: PaymentOptionKind };

type PendingAction = {
  orderId: string;
  type: "CANCEL" | "PAYMENT";
  authorizationCode: string;
  confirmationOrderNo: string;
  cancellationReason: CancellationReason;
  detail: string;
  paymentOptionId: string;
  reason: string;
};

export function CompletedOrdersPanel({
  stallSlug,
  currency,
  requiresAuthorizationCode,
  canPrintReceipt,
}: {
  stallSlug: string;
  currency: string;
  requiresAuthorizationCode: boolean;
  canPrintReceipt: boolean;
}) {
  const { locale, t } = useOperationsLocale();
  const [open, setOpen] = useState(false);
  const [orders, setOrders] = useState<CompletedOrder[]>([]);
  const [paymentOptions, setPaymentOptions] = useState<PaymentOption[]>([]);
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<"ALL" | "COMPLETED" | "CANCELLED">("ALL");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const load = useCallback(async (nextQuery = query, nextStatus = status) => {
    setLoading(true);
    setMessage("");
    try {
      const parameters = new URLSearchParams({ query: nextQuery, status: nextStatus });
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/completed-orders?${parameters}`, { cache: "no-store" });
      const payload = await readApiJson<{ orders?: CompletedOrder[]; paymentOptions?: PaymentOption[]; error?: string }>(
        response,
        t("completedOrders.loadFailed"),
      );
      if (!response.ok) throw new Error(payload.error ?? t("completedOrders.loadFailed"));
      setOrders(payload.orders ?? []);
      setPaymentOptions(payload.paymentOptions ?? []);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("completedOrders.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [query, stallSlug, status, t]);

  function togglePanel() {
    const next = !open;
    setOpen(next);
    if (next && orders.length === 0) void load();
  }

  function openAction(order: CompletedOrder, type: PendingAction["type"]) {
    setPendingAction({
      orderId: order.id,
      type,
      authorizationCode: "",
      confirmationOrderNo: "",
      cancellationReason: "CUSTOMER_CANCELLED",
      detail: "",
      paymentOptionId: paymentOptions.find((option) => option.id !== order.payment?.paymentOptionId)?.id ?? "",
      reason: "",
    });
  }

  async function submitAction(order: CompletedOrder) {
    if (!pendingAction || pendingAction.orderId !== order.id) return;
    setLoading(true);
    setMessage("");
    try {
      const body = pendingAction.type === "CANCEL" ? {
        operation: "CANCEL_COMPLETED_ORDER",
        orderId: order.id,
        confirmationOrderNo: pendingAction.confirmationOrderNo,
        cancellationReason: pendingAction.cancellationReason,
        cancellationDetail: pendingAction.detail.trim() || null,
        managerAuthorizationCode: pendingAction.authorizationCode || null,
      } : {
        operation: "CHANGE_COMPLETED_PAYMENT",
        orderId: order.id,
        paymentOptionId: pendingAction.paymentOptionId,
        reason: pendingAction.reason.trim(),
        managerAuthorizationCode: pendingAction.authorizationCode || null,
      };
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/completed-orders`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(body),
      });
      const payload = await readApiJson<{ error?: string; warning?: string }>(
        response,
        t("completedOrders.updateFailed"),
      );
      if (!response.ok) throw new Error(payload.error ?? t("completedOrders.updateFailed"));
      setPendingAction(null);
      const successMessage = payload.warning ?? t("completedOrders.updated");
      await load();
      setMessage(successMessage);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("completedOrders.updateFailed"));
    } finally {
      setLoading(false);
    }
  }

  async function printReceipt(orderId: string) {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${encodeURIComponent(stallSlug)}/print-jobs`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({ operation: "QUEUE_RECEIPT", orderId }),
      });
      const payload = await readApiJson<{ error?: string }>(response, t("completedOrders.receiptFailed"));
      if (!response.ok) throw new Error(payload.error ?? t("completedOrders.receiptFailed"));
      setMessage(t("completedOrders.receiptQueued"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t("completedOrders.receiptFailed"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-stone-300 bg-white shadow-sm" aria-labelledby="completed-orders-heading">
      <button
        type="button"
        onClick={togglePanel}
        aria-expanded={open}
        className="flex min-h-14 w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="inline-flex min-w-0 items-center gap-2 font-semibold text-stone-900">
          <History className="h-5 w-5 shrink-0 text-teal-700" />
          <span id="completed-orders-heading">{t("completedOrders.title")}</span>
        </span>
        {open ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
      </button>
      {open ? (
        <div className="border-t border-stone-200 p-4">
          <p className="text-sm text-stone-600">{t("completedOrders.description")}</p>
          <p className="mt-1 text-xs font-semibold text-teal-800">{t("completedOrders.todayOnly")}</p>
          <form
            className="mt-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_10rem_auto]"
            onSubmit={(event) => { event.preventDefault(); void load(); }}
          >
            <label className="relative">
              <span className="sr-only">{t("completedOrders.search")}</span>
              <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-stone-500" />
              <input
                type="search"
                value={query}
                maxLength={80}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("completedOrders.searchPlaceholder")}
                className="h-10 w-full rounded-md border border-stone-300 pl-9 pr-3 text-sm"
              />
            </label>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              aria-label={t("completedOrders.statusFilter")}
              className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm"
            >
              <option value="ALL">{t("completedOrders.all")}</option>
              <option value="COMPLETED">{t("completedOrders.completed")}</option>
              <option value="CANCELLED">{t("completedOrders.cancelled")}</option>
            </select>
            <button type="submit" disabled={loading} className="h-10 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">
              {loading ? t("common.loading") : t("completedOrders.search")}
            </button>
          </form>
          {message ? <p role="status" className="mt-3 rounded-md bg-amber-50 p-3 text-sm font-medium text-amber-950">{message}</p> : null}
          <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">
            {orders.map((order) => {
              const expanded = expandedIds.has(order.id);
              const action = pendingAction?.orderId === order.id ? pendingAction : null;
              return (
                <article key={order.id} className="py-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => setExpandedIds((current) => {
                        const next = new Set(current);
                        if (next.has(order.id)) next.delete(order.id); else next.add(order.id);
                        return next;
                      })}
                      aria-expanded={expanded}
                      className="min-w-0 text-left"
                    >
                      <span className="font-semibold text-stone-950">#{order.orderNo} · {order.customerName || t("completedOrders.walkIn")}</span>
                      <span className="mt-1 block text-xs text-stone-600">
                        {formatAppDateTime(locale, order.completedAt ?? order.createdAt, { dateStyle: "short", timeStyle: "short" })}
                        {` · ${order.payment?.methodLabel ?? t("completedOrders.noPayment")}`}
                        {` · ${formatMoney(order.total, currency, locale)}`}
                      </span>
                    </button>
                    <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${order.status === "COMPLETED" ? "bg-emerald-100 text-emerald-800" : "bg-stone-200 text-stone-700"}`}>
                      {order.status === "COMPLETED" ? t("completedOrders.completed") : t("completedOrders.cancelled")}
                    </span>
                  </div>
                  {expanded ? (
                    <div className="mt-4 rounded-md bg-stone-50 p-4">
                      <ul className="space-y-2 text-sm">
                        {order.items.map((item) => (
                          <li key={item.id} className="flex items-start justify-between gap-4">
                            <span>
                              <strong>{item.quantity} × {item.name}</strong>
                              {item.noteOptions.length > 0 ? <span className="mt-0.5 block text-xs text-stone-600">{item.noteOptions.map((option) => `${option.groupName}：${option.optionName}`).join("、")}</span> : null}
                              {item.note ? <span className="mt-0.5 block text-xs text-stone-600">{item.note}</span> : null}
                            </span>
                            <span className="shrink-0">{formatMoney(item.unitPrice * item.quantity, currency, locale)}</span>
                          </li>
                        ))}
                      </ul>
                      <dl className="mt-4 space-y-1 border-t border-stone-200 pt-3 text-sm">
                        <div className="flex justify-between"><dt>{t("completedOrders.subtotal")}</dt><dd>{formatMoney(order.subtotal, currency, locale)}</dd></div>
                        {order.discountAmount > 0 ? <div className="flex justify-between text-emerald-800"><dt>{order.discountLabel ?? t("completedOrders.discount")}</dt><dd>-{formatMoney(order.discountAmount, currency, locale)}</dd></div> : null}
                        <div className="flex justify-between font-semibold"><dt>{t("completedOrders.total")}</dt><dd>{formatMoney(order.total, currency, locale)}</dd></div>
                      </dl>
                      {order.note ? <p className="mt-3 text-xs text-stone-600">{t("completedOrders.note")}：{order.note}</p> : null}
                      {order.status === "COMPLETED" ? (
                        <div className="mt-4 flex flex-wrap gap-2 border-t border-stone-200 pt-4">
                          <button type="button" onClick={() => openAction(order, "PAYMENT")} className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold">
                            {t("completedOrders.changePayment")}
                          </button>
                          <button type="button" onClick={() => openAction(order, "CANCEL")} className="min-h-10 rounded-md border border-red-300 bg-white px-3 text-sm font-semibold text-red-700">
                            {t("completedOrders.cancelOrder")}
                          </button>
                          {canPrintReceipt ? <button type="button" disabled={loading} onClick={() => void printReceipt(order.id)} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold disabled:opacity-50"><Printer className="h-4 w-4" />{t("completedOrders.printReceipt")}</button> : null}
                        </div>
                      ) : (
                        <p className="mt-4 text-xs font-medium text-stone-600">{t("completedOrders.cancelledPaymentWarning")}</p>
                      )}
                      {action ? (
                        <div className="mt-4 rounded-md border border-amber-300 bg-amber-50 p-4">
                          <div className="flex items-center gap-2 font-semibold text-amber-950"><ShieldCheck className="h-4 w-4" />{action.type === "CANCEL" ? t("completedOrders.cancelOrder") : t("completedOrders.changePayment")}</div>
                          {action.type === "CANCEL" ? (
                            <div className="mt-3 grid gap-3">
                              <label className="text-xs font-semibold text-stone-700">{t("completedOrders.confirmOrderNo")}<input type="text" maxLength={32} value={action.confirmationOrderNo} onChange={(event) => setPendingAction({ ...action, confirmationOrderNo: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label>
                              <label className="text-xs font-semibold text-stone-700">{t("completedOrders.cancelReason")}<select value={action.cancellationReason} onChange={(event) => setPendingAction({ ...action, cancellationReason: event.target.value as CancellationReason })} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{cancellationReasonOptions.map((option) => <option key={option.value} value={option.value}>{t(cancellationReasonMessageKey(option.value))}</option>)}</select></label>
                              <label className="text-xs font-semibold text-stone-700">{t("completedOrders.reasonDetail")}<textarea value={action.detail} maxLength={200} onChange={(event) => setPendingAction({ ...action, detail: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-stone-300 bg-white p-3 text-sm" /></label>
                              <p className="text-xs font-medium text-red-800">{t("completedOrders.refundWarning")}</p>
                            </div>
                          ) : (
                            <div className="mt-3 grid gap-3">
                              <label className="text-xs font-semibold text-stone-700">{t("completedOrders.newPayment")}<select value={action.paymentOptionId} onChange={(event) => setPendingAction({ ...action, paymentOptionId: event.target.value })} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{paymentOptions.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}</select></label>
                              <label className="text-xs font-semibold text-stone-700">{t("completedOrders.correctionReason")}<textarea value={action.reason} maxLength={200} onChange={(event) => setPendingAction({ ...action, reason: event.target.value })} className="mt-1 min-h-20 w-full rounded-md border border-stone-300 bg-white p-3 text-sm" /></label>
                              <p className="text-xs text-stone-700">{t("completedOrders.paymentOnly")}</p>
                            </div>
                          )}
                          {requiresAuthorizationCode ? <label className="mt-3 block text-xs font-semibold text-stone-700">{t("completedOrders.authorizationCode")}<input type="password" inputMode="numeric" pattern="[0-9]*" maxLength={8} autoComplete="one-time-code" value={action.authorizationCode} onChange={(event) => setPendingAction({ ...action, authorizationCode: event.target.value.replace(/\D/g, "").slice(0, 8) })} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label> : null}
                          <div className="mt-4 flex justify-end gap-2">
                            <button type="button" onClick={() => setPendingAction(null)} className="min-h-10 rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold">{t("common.back")}</button>
                            <button
                              type="button"
                              disabled={loading
                                || (requiresAuthorizationCode && !/^\d{4,8}$/.test(action.authorizationCode))
                                || (action.type === "CANCEL" && (action.confirmationOrderNo !== order.orderNo || (action.cancellationReason === "OTHER" && !action.detail.trim())))
                                || (action.type === "PAYMENT" && (!action.paymentOptionId || action.reason.trim().length < 3))}
                              onClick={() => void submitAction(order)}
                              className="min-h-10 rounded-md bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-40"
                            >
                              {loading ? t("common.loading") : t("completedOrders.confirm")}
                            </button>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
            {!loading && orders.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">{t("completedOrders.empty")}</p> : null}
          </div>
          <p className="mt-3 text-xs text-stone-500">{t("completedOrders.limitNote")}</p>
        </div>
      ) : null}
    </section>
  );
}

function cancellationReasonMessageKey(reason: CancellationReason): OperationsMessageKey {
  if (reason === "SOLD_OUT") return "cancelReason.soldOut";
  if (reason === "CUSTOMER_CANCELLED") return "cancelReason.customer";
  if (reason === "WAIT_TOO_LONG") return "cancelReason.wait";
  if (reason === "DUPLICATE_ORDER") return "cancelReason.duplicate";
  return "cancelReason.other";
}
