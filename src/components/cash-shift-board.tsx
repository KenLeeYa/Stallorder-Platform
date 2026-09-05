"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { SettingsFeedbackDialog, type SettingsFeedbackKind } from "@/components/settings-feedback-dialog";
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  CircleDollarSign,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import { OfflineQueueStatus } from "@/components/offline-queue-status";
import { csrfHeaders } from "@/lib/csrf-client";
import { calendarDateInTimeZone } from "@/lib/date-time";
import { formatAppDateTime, formatAppNumber } from "@/lib/locale-format";
import { getOperationsErrorMessageKey } from "@/lib/messages/operations-errors";
import { formatMoney } from "@/lib/money";
import {
  buildOperationsPageMeta,
  OPERATIONS_PAGE_SIZES,
  type OperationsPageMeta,
  type OperationsPageSize,
} from "@/lib/operations-pagination";

type ShiftStatus = "OPEN" | "CLOSING" | "REVIEW_REQUIRED" | "CLOSED";
type MovementType =
  | "OPENING_FLOAT"
  | "CASH_SALE"
  | "CASH_REFUND"
  | "CASH_IN"
  | "CASH_OUT"
  | "CORRECTION";

type Movement = {
  id: string;
  type: MovementType;
  amount: number;
  reason: string;
  createdAt: string;
  recordedBy: { displayName: string };
};

type Review = {
  id: string;
  decision: "APPROVED" | "REJECTED" | "ADJUSTMENT_REQUIRED";
  comment: string | null;
  reviewedAt: string;
  reviewedBy: { displayName: string };
};

type Shift = {
  id: string;
  status: ShiftStatus;
  openingAmount: number;
  systemExpectedAmount: number | null;
  countedAmount: number | null;
  varianceAmount: number | null;
  note: string | null;
  openedAt: string;
  closedAt: string | null;
  openedBy: { displayName: string };
  closedBy: { displayName: string } | null;
  movements: Movement[];
  reviews: Review[];
};

type RuntimeShift = Shift & {
  cashSales: number;
  cashIn: number;
  cashOut: number;
  cashRefund: number;
  correction: number;
  expectedAmount: number;
};

type RefundablePayment = {
  id: string;
  amount: number;
  paidAt: string;
  order: { orderNo: string };
};

export type CashShiftState = {
  openShift: RuntimeShift | null;
  history: Shift[];
  refundablePayments: RefundablePayment[];
};

type CashShiftPermissions = {
  canManage: boolean;
  canReview: boolean;
  reconciliationEnabled: boolean;
};

type CashShiftAction = "OPEN" | "MOVE" | "REFUND" | "CLOSE";
type CashHistoryPreset = "TODAY" | "YESTERDAY" | "WEEK" | "MONTH" | "CUSTOM";

export function CashShiftBoard({
  stall,
  initialState,
  initialPermissions,
}: {
  stall: { id: string; organizationId: string; slug: string; name: string; currency: string };
  initialState: CashShiftState;
  initialPermissions: CashShiftPermissions;
}) {
  const { locale, t } = useOperationsLocale();
  const [state, setState] = useState(initialState);
  const [permissions, setPermissions] = useState(initialPermissions);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openNote, setOpenNote] = useState("");
  const [movementType, setMovementType] = useState<"CASH_IN" | "CASH_OUT">("CASH_IN");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [movementAuthorizationCode, setMovementAuthorizationCode] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [refundAuthorizationCode, setRefundAuthorizationCode] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [adjustingShiftId, setAdjustingShiftId] = useState<string | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<SettingsFeedbackKind>("success");
  const [activeAction, setActiveAction] = useState<CashShiftAction | null>(null);
  const initialHistoryDate = calendarDateInTimeZone(new Date(), "Asia/Taipei");
  const [historyPreset, setHistoryPreset] = useState<CashHistoryPreset>("TODAY");
  const [historyDateFrom, setHistoryDateFrom] = useState(initialHistoryDate);
  const [historyDateTo, setHistoryDateTo] = useState(initialHistoryDate);
  const [historyPage, setHistoryPage] = useState(1);
  const [historyPageSize, setHistoryPageSize] = useState<OperationsPageSize>(5);
  const actionTriggerRef = useRef<HTMLElement | null>(null);
  const [offlineSnapshot, setOfflineSnapshot] = useState<Awaited<
    ReturnType<typeof import("@/offline/offline-operations")["getOfflineCashShiftSnapshot"]>
  >>(null);

  const applyPayload = useCallback((payload: { state?: CashShiftState; permissions?: CashShiftPermissions }) => {
    if (payload.state) setState(payload.state);
    if (payload.permissions) setPermissions(payload.permissions);
  }, []);

  function openAction(action: CashShiftAction) {
    if (document.activeElement instanceof HTMLElement) actionTriggerRef.current = document.activeElement;
    setMessage("");
    setActiveAction(action);
  }

  function closeAction() {
    if (busy) return;
    const previousFocus = actionTriggerRef.current;
    setActiveAction(null);
    window.requestAnimationFrame(() => {
      if (previousFocus?.isConnected && !previousFocus.matches(":disabled")) previousFocus.focus();
    });
  }

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stalls/${stall.slug}/cash-shifts`, { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) applyPayload(payload);
  }, [applyPayload, stall.slug]);

  const refreshOfflineSnapshot = useCallback(async () => {
    if (!("indexedDB" in window)) return;
    const { getOfflineCashShiftSnapshot } = await import("@/offline/offline-operations");
    setOfflineSnapshot(await getOfflineCashShiftSnapshot(stall.id));
  }, [stall.id]);

  const run = useCallback(async (command: Record<string, unknown>, successMessage: string) => {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/cash-shifts`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(t(getOperationsErrorMessageKey(payload.code, "cash.error.update")));
      applyPayload(payload);
      setMessageKind("success");
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error ? error.message : t("staff.error.network"));
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyPayload, stall.slug, t]);

  useEffect(() => {
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    const onOfflineDataChanged = () => void refreshOfflineSnapshot();
    const initialRefresh = window.setTimeout(() => void refreshOfflineSnapshot(), 0);
    window.addEventListener("stallorder:offline-data-changed", onOfflineDataChanged);
    return () => {
      window.clearTimeout(initialRefresh);
      window.removeEventListener("stallorder:offline-data-changed", onOfflineDataChanged);
    };
  }, [refreshOfflineSnapshot]);

  async function openShift() {
    const amount = Number(openingAmount);
    if (!Number.isInteger(amount) || amount < 0) return;
    if (await run(
      { operation: "OPEN", openingAmount: amount, note: openNote.trim() || null },
      t("cash.success.open"),
    )) {
      setOpeningAmount("");
      setOpenNote("");
      closeAction();
    }
  }

  async function addMovement() {
    if (!state.openShift) return;
    const amount = Number(movementAmount);
    if (!Number.isInteger(amount) || amount <= 0 || !movementReason.trim()) return;
    if (!navigator.onLine) {
      const saved = await addOfflineCashEvent({
        eventType: movementType,
        amount,
        reason: movementReason.trim(),
      }, t("cash.success.offlineMovement"));
      if (saved) {
        setMovementAmount("");
        setMovementReason("");
        closeAction();
      }
      return;
    }
    if (await run({
      operation: "MOVE",
      shiftId: state.openShift.id,
      type: movementType,
      amount,
      reason: movementReason.trim(),
      ...(movementType === "CASH_OUT" && movementAuthorizationCode
        ? { managerAuthorizationCode: movementAuthorizationCode }
        : {}),
    }, t("cash.success.movement"))) {
      setMovementAmount("");
      setMovementReason("");
      setMovementAuthorizationCode("");
      closeAction();
    }
  }

  async function refundPayment() {
    if (!state.openShift || !refundPaymentId || !refundReason.trim()) return;
    if (await run({
      operation: "REFUND",
      shiftId: state.openShift.id,
      paymentId: refundPaymentId,
      reason: refundReason.trim(),
      ...(refundAuthorizationCode ? { managerAuthorizationCode: refundAuthorizationCode } : {}),
    }, t("cash.success.refund"))) {
      setRefundPaymentId("");
      setRefundReason("");
      setRefundAuthorizationCode("");
      closeAction();
    }
  }

  async function closeShift() {
    if (!state.openShift) return;
    const amount = Number(countedAmount);
    if (!Number.isInteger(amount) || amount < 0) return;
    const successMessage = permissions.reconciliationEnabled
      ? t("cash.success.closeForReview")
      : t("cash.success.close");
    if (!navigator.onLine) {
      const saved = await addOfflineCashEvent({
        eventType: "PROVISIONAL_CLOSE",
        amount: activeExpectedAmount,
        countedAmount: amount,
        reason: closeNote.trim() || "OFFLINE_PROVISIONAL_CLOSE",
      }, t("cash.success.provisionalClose"));
      if (saved) {
        setCountedAmount("");
        setCloseNote("");
        closeAction();
      }
      return;
    }
    if (await run({
      operation: "CLOSE",
      shiftId: state.openShift.id,
      countedAmount: amount,
      note: closeNote.trim() || null,
    }, successMessage)) {
      setCountedAmount("");
      setCloseNote("");
      closeAction();
    }
  }

  async function addOfflineCashEvent(
    input: {
      eventType: "CASH_IN" | "CASH_OUT" | "PROVISIONAL_CLOSE";
      amount: number;
      countedAmount?: number;
      reason: string;
    },
    successMessage: string,
  ) {
    setBusy(true);
    setMessage("");
    try {
      const { createOfflineCashEvent } = await import("@/offline/offline-operations");
      await createOfflineCashEvent({
        organizationId: stall.organizationId,
        stallId: stall.id,
        ...input,
      });
      await refreshOfflineSnapshot();
      setMessageKind("success");
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessageKind("error");
      setMessage(error instanceof Error
        ? offlineCashErrorMessage(error.message, t)
        : t("cash.error.offlineGeneric"));
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function reviewShift(
    shiftId: string,
    decision: "APPROVED" | "REJECTED" | "ADJUSTMENT_REQUIRED",
  ) {
    const comment = reviewComments[shiftId]?.trim() || null;
    if (decision !== "APPROVED" && !comment) {
      setMessageKind("error");
      setMessage(t("cash.review.reasonRequired"));
      return;
    }
    if (await run({ operation: "REVIEW", shiftId, decision, comment }, t("cash.success.review"))) {
      setReviewComments((current) => ({ ...current, [shiftId]: "" }));
    }
  }

  async function adjustShift() {
    if (!adjustingShiftId || !adjustmentReason.trim()) return;
    const amount = Number(adjustmentAmount);
    if (!Number.isInteger(amount) || amount === 0) return;
    if (await run({
      operation: "ADJUST",
      shiftId: adjustingShiftId,
      amount,
      reason: adjustmentReason.trim(),
    }, t("cash.success.adjust"))) {
      setAdjustingShiftId(null);
      setAdjustmentAmount("");
      setAdjustmentReason("");
    }
  }

  const activeOfflineSnapshot = state.openShift
    && offlineSnapshot?.shiftId === state.openShift.id
    ? offlineSnapshot
    : null;
  const activeExpectedAmount = activeOfflineSnapshot?.expectedAmount
    ?? state.openShift?.expectedAmount
    ?? 0;
  const localProvisionalClose = activeOfflineSnapshot?.status === "PROVISIONAL_CLOSE";
  const counted = countedAmount === "" ? null : Number(countedAmount);
  const liveVariance = state.openShift && counted !== null && Number.isFinite(counted)
    ? counted - activeExpectedAmount
    : null;
  const filteredHistory = useMemo(() => state.history.filter((shift) => {
    const openedOn = calendarDateInTimeZone(new Date(shift.openedAt), "Asia/Taipei");
    return (!historyDateFrom || openedOn >= historyDateFrom)
      && (!historyDateTo || openedOn <= historyDateTo);
  }), [historyDateFrom, historyDateTo, state.history]);
  const historyPagination = buildOperationsPageMeta(filteredHistory.length, {
    page: historyPage,
    pageSize: historyPageSize,
  });
  const visibleHistory = filteredHistory.slice(
    (historyPagination.page - 1) * historyPagination.pageSize,
    historyPagination.page * historyPagination.pageSize,
  );

  function applyHistoryPreset(preset: Exclude<CashHistoryPreset, "CUSTOM">) {
    const today = calendarDateInTimeZone(new Date(), "Asia/Taipei");
    const start = new Date(`${today}T00:00:00.000Z`);
    const end = new Date(start);
    if (preset === "YESTERDAY") {
      start.setUTCDate(start.getUTCDate() - 1);
      end.setUTCDate(end.getUTCDate() - 1);
    }
    if (preset === "WEEK") start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
    if (preset === "MONTH") start.setUTCDate(1);
    setHistoryPreset(preset);
    setHistoryDateFrom(start.toISOString().slice(0, 10));
    setHistoryDateTo(end.toISOString().slice(0, 10));
    setHistoryPage(1);
  }

  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 md:px-8">
    <header className="flex items-start justify-between gap-4">
      <div>
        <ContextualBackButton fallbackHref={`/staff/${stall.slug}`} className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-teal-800">{t("cash.back")}</ContextualBackButton>
        <h1 className="mt-2 text-3xl font-semibold">{t("cash.title")}</h1>
        <p className="mt-1 text-sm text-stone-500">{stall.name}</p>
      </div>
      <button type="button" title={t("common.refresh")} onClick={() => void refresh()} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-stone-300">
        <RefreshCw className="h-4 w-4" />
      </button>
    </header>

    {!permissions.canManage ? <p className="mt-4 border-l-4 border-stone-300 pl-3 text-sm text-stone-600">{t("cash.readOnly")}</p> : null}
    {message && !activeAction ? <SettingsFeedbackDialog message={message} kind={messageKind} onClose={() => setMessage("")} /> : null}
    <OfflineQueueStatus
      stallId={stall.id}
      stallSlug={stall.slug}
      onSynchronized={() => {
        void refresh();
        void refreshOfflineSnapshot();
      }}
    />
    {activeOfflineSnapshot && activeOfflineSnapshot.pendingEvents.length > 0 ? (
      <section className="mt-4 border-l-4 border-blue-500 bg-blue-50 px-4 py-3 text-sm text-blue-950">
        <strong>{t("cash.offline.pending", { count: activeOfflineSnapshot.pendingEvents.length })}</strong>
        <p className="mt-1">{t("cash.offline.expected", { amount: formatMoney(activeExpectedAmount, stall.currency, locale) })}</p>
      </section>
    ) : null}

    {!state.openShift ? <section aria-labelledby="cash-shift-overview-title" className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
      <div className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-teal-700" /><h2 id="cash-shift-overview-title" className="text-lg font-semibold">{t("cash.overview")}</h2></div>
      <div data-testid="cash-shift-dashboard" className="mt-4 grid grid-cols-2 gap-2 sm:max-w-lg">
        <Metric label={t("cash.currentStatus")} value={t("cash.notOpened")} />
        <Metric label={t("cash.historyCount")} value={t("cash.count", { count: state.history.length })} />
      </div>
      {permissions.canManage ? <button type="button" disabled={busy} onClick={() => openAction("OPEN")} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"><WalletCards className="h-4 w-4" />{t("cash.start")}</button> : <p className="mt-3 text-sm text-stone-500">{t("cash.noActive")}</p>}
    </section> : <>
      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">{t("cash.active")}</h2><p className="mt-1 text-xs text-stone-500">{state.openShift.openedBy.displayName} · {formatAppDateTime(locale, state.openShift.openedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</p></div><StatusBadge status="OPEN" t={t} /></div>
        <div data-testid="cash-shift-dashboard" className="mt-4 grid grid-cols-2 gap-2 min-[380px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-7">
          <Metric label={t("cash.metric.opening")} value={formatMoney(state.openShift.openingAmount, stall.currency, locale)} />
          <Metric label={t("cash.metric.sales")} value={formatMoney(activeOfflineSnapshot?.cashSales ?? state.openShift.cashSales, stall.currency, locale)} />
          <Metric label={t("cash.metric.refund")} value={`-${formatMoney(state.openShift.cashRefund, stall.currency, locale)}`} />
          <Metric label={t("cash.metric.in")} value={formatMoney(activeOfflineSnapshot?.cashIn ?? state.openShift.cashIn, stall.currency, locale)} />
          <Metric label={t("cash.metric.out")} value={`-${formatMoney(activeOfflineSnapshot?.cashOut ?? state.openShift.cashOut, stall.currency, locale)}`} />
          <Metric label={t("cash.metric.adjustment")} value={formatSignedMoney(state.openShift.correction, stall.currency, locale)} />
          <Metric label={t("cash.metric.expected")} value={formatMoney(activeExpectedAmount, stall.currency, locale)} strong />
        </div>
      </section>

      {permissions.canManage ? <section aria-labelledby="cash-shift-actions-title" className="mt-7 border-y border-stone-200 py-5">
        <h2 id="cash-shift-actions-title" className="text-lg font-semibold">{t("cash.actions")}</h2>
        <div data-testid="cash-shift-actions-dashboard" className="mt-3 grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
          <ActionCard label={t("cash.action.movement")} description={t("cash.action.movementDescription")} icon={<CircleDollarSign className="h-5 w-5" />} disabled={busy || localProvisionalClose} onClick={() => openAction("MOVE")} />
          <ActionCard label={t("cash.metric.refund")} description={state.refundablePayments.length > 0 ? t("cash.action.refundable", { count: state.refundablePayments.length }) : t("cash.action.noRefund")} icon={<RotateCcw className="h-5 w-5" />} disabled={busy || state.refundablePayments.length === 0} onClick={() => openAction("REFUND")} />
          <ActionCard label={t("cash.action.close")} description={permissions.reconciliationEnabled ? t("cash.action.closeReview") : t("cash.action.closeComplete")} icon={<CheckCircle2 className="h-5 w-5" />} disabled={busy || localProvisionalClose} onClick={() => openAction("CLOSE")} />
        </div>
      </section> : null}

      <MovementList movements={state.openShift.movements} currency={stall.currency} locale={locale} t={t} />
    </>}

    {activeAction === "OPEN" ? <CashShiftDialog title={t("cash.dialog.open")} description={t("cash.dialog.openDescription")} busy={busy} message={message} onDismiss={closeAction} t={t}>
      <form onSubmit={(event) => { event.preventDefault(); void openShift(); }} className="grid gap-4">
        <MoneyInput label={t("cash.metric.opening")} value={openingAmount} onChange={setOpeningAmount} initialFocus />
        <TextInput label={t("cash.noteOptional")} value={openNote} onChange={setOpenNote} maxLength={500} />
        <button type="submit" disabled={busy || openingAmount === ""} className="min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{t("cash.startShift")}</button>
      </form>
    </CashShiftDialog> : null}

    {activeAction === "MOVE" && state.openShift ? <CashShiftDialog title={t("cash.dialog.movement")} description={t("cash.dialog.movementDescription")} busy={busy} message={message} onDismiss={closeAction} t={t}>
      <form onSubmit={(event) => { event.preventDefault(); void addMovement(); }} className="grid gap-4">
        <label className="text-xs font-semibold text-stone-600">{t("cash.type")}<select data-dialog-initial-focus value={movementType} onChange={(event) => setMovementType(event.target.value as "CASH_IN" | "CASH_OUT")} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="CASH_IN">{t("cash.metric.in")}</option><option value="CASH_OUT">{t("cash.metric.out")}</option></select></label>
        <MoneyInput label={t("cash.amount")} value={movementAmount} onChange={setMovementAmount} />
        <TextInput label={t("cash.reason")} value={movementReason} onChange={setMovementReason} maxLength={200} />
        {movementType === "CASH_OUT" ? <AuthorizationCodeInput label={t("cash.managerAuthorizationCode")} value={movementAuthorizationCode} onChange={setMovementAuthorizationCode} /> : null}
        <button type="submit" disabled={busy || localProvisionalClose || !movementAmount || !movementReason.trim()} className="min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{t("cash.addRecord")}</button>
      </form>
    </CashShiftDialog> : null}

    {activeAction === "REFUND" && state.openShift ? <CashShiftDialog title={t("cash.dialog.refund")} description={t("cash.dialog.refundDescription")} busy={busy} message={message} onDismiss={closeAction} t={t}>
      <form onSubmit={(event) => { event.preventDefault(); void refundPayment(); }} className="grid gap-4">
        <label className="text-xs font-semibold text-stone-600">{t("cash.originalPayment")}<select data-dialog-initial-focus value={refundPaymentId} onChange={(event) => setRefundPaymentId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="">{t("cash.choosePayment")}</option>{state.refundablePayments.map((payment) => <option key={payment.id} value={payment.id}>{payment.order.orderNo} · {formatMoney(payment.amount, stall.currency, locale)}</option>)}</select></label>
        <TextInput label={t("cash.refundReason")} value={refundReason} onChange={setRefundReason} maxLength={200} />
        <AuthorizationCodeInput label={t("cash.managerAuthorizationCode")} value={refundAuthorizationCode} onChange={setRefundAuthorizationCode} />
        <button type="submit" disabled={busy || !refundPaymentId || !refundReason.trim()} className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{t("cash.confirmRefund")}</button>
      </form>
    </CashShiftDialog> : null}

    {activeAction === "CLOSE" && state.openShift ? <CashShiftDialog title={t("cash.dialog.close")} description={t("cash.dialog.closeDescription", { amount: formatMoney(activeExpectedAmount, stall.currency, locale) })} busy={busy} message={message} onDismiss={closeAction} t={t}>
      <form onSubmit={(event) => { event.preventDefault(); void closeShift(); }} className="grid gap-4">
        <MoneyInput label={t("cash.countedAmount")} value={countedAmount} onChange={setCountedAmount} initialFocus />
        <TextInput label={t("cash.handoffNoteOptional")} value={closeNote} onChange={setCloseNote} maxLength={500} />
        {liveVariance !== null ? <Variance amount={liveVariance} currency={stall.currency} locale={locale} t={t} /> : null}
        <button type="submit" disabled={busy || localProvisionalClose || counted === null || counted < 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{localProvisionalClose ? t("cash.provisionalWaiting") : permissions.reconciliationEnabled ? t("cash.submitReview") : t("cash.completeHandoff")}</button>
      </form>
    </CashShiftDialog> : null}

    <section className="border-t border-stone-200 py-6">
      <div className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-semibold">{t("cash.historyTitle")}</h2></div>
      <div data-testid="cash-history-filters" className="mt-4 rounded-xl border border-stone-200 bg-stone-50 p-3 sm:p-4">
        <div className="flex flex-wrap gap-2" aria-label={t("cash.historyPresets")}>
          {(["TODAY", "YESTERDAY", "WEEK", "MONTH", "CUSTOM"] as const).map((preset) => <button key={preset} type="button" aria-pressed={historyPreset === preset} onClick={() => preset === "CUSTOM" ? setHistoryPreset("CUSTOM") : applyHistoryPreset(preset)} className={`min-h-11 rounded-lg px-3 text-sm font-semibold ${historyPreset === preset ? "bg-stone-900 text-white" : "border border-stone-300 bg-white text-stone-800"}`}>{preset === "TODAY" ? t("cash.historyDay") : preset === "YESTERDAY" ? t("cash.historyYesterday") : preset === "WEEK" ? t("cash.historyWeek") : preset === "MONTH" ? t("cash.historyMonth") : t("cash.historyCustom")}</button>)}
        </div>
        {historyPreset === "CUSTOM" ? <div className="mt-3 grid gap-2 min-[420px]:grid-cols-[1fr_auto_1fr] min-[420px]:items-end">
          <label className="text-xs font-semibold text-stone-600">{t("cash.historyDateFrom")}<input data-testid="cash-history-date-from" type="date" value={historyDateFrom} onChange={(event) => { setHistoryDateFrom(event.target.value); setHistoryPage(1); }} className="mt-1 h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900" /></label>
          <span className="hidden pb-3 text-center text-sm text-stone-500 min-[420px]:block">{t("cash.historyTo")}</span>
          <label className="text-xs font-semibold text-stone-600">{t("cash.historyDateTo")}<input data-testid="cash-history-date-to" type="date" min={historyDateFrom || undefined} value={historyDateTo} onChange={(event) => { setHistoryDateTo(event.target.value); setHistoryPage(1); }} className="mt-1 h-11 w-full rounded-lg border border-stone-300 bg-white px-3 text-sm text-stone-900" /></label>
        </div> : <p className="mt-3 text-sm text-stone-600">{historyDateFrom} {t("cash.historyDateRangeTo")} {historyDateTo}</p>}
        <div className="mt-3 flex flex-wrap items-center justify-end gap-3">
          <CashHistoryPageSizeSelect locale={locale} t={t} value={historyPageSize} onChange={(value) => { setHistoryPageSize(value); setHistoryPage(1); }} />
        </div>
      </div>
      <div className="mt-3 grid gap-3">
        {visibleHistory.map((shift) => <article key={shift.id} className="min-w-0 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><strong>{formatAppDateTime(locale, shift.openedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</strong><p className="mt-1 break-words text-xs text-stone-500">{shift.openedBy.displayName} → {shift.closedBy?.displayName ?? "-"} · {shift.closedAt ? formatAppDateTime(locale, shift.closedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }) : "-"}</p></div>
            <StatusBadge status={shift.status} t={t} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm min-[380px]:grid-cols-4">
            <HistoryMetric label={t("cash.metric.openingShort")} value={formatMoney(shift.openingAmount, stall.currency, locale)} />
            <HistoryMetric label={t("cash.metric.expected")} value={formatMoney(shift.systemExpectedAmount ?? 0, stall.currency, locale)} />
            <HistoryMetric label={t("cash.metric.counted")} value={formatMoney(shift.countedAmount ?? 0, stall.currency, locale)} />
            <HistoryMetric label={t("cash.metric.variance")} value={formatSignedMoney(shift.varianceAmount ?? 0, stall.currency, locale)} emphasize={(shift.varianceAmount ?? 0) !== 0} />
          </div>
          <CollapsibleHistoryDetails initiallyOpen={shift.status === "CLOSING" || shift.status === "REVIEW_REQUIRED"} t={t}>
            {shift.note ? <p className="break-words text-sm text-stone-600">{t("cash.handoffNote", { note: shift.note })}</p> : <p className="text-sm text-stone-500">{t("cash.noHandoffNote")}</p>}
            {shift.reviews.length > 0 ? <div className="mt-4 border-l-2 border-stone-200 pl-3"><h3 className="text-sm font-semibold">{t("cash.reviewHistory")}</h3>{shift.reviews.map((review) => <p key={review.id} className="mt-2 break-words text-xs text-stone-600">{reviewDecisionLabel(review.decision, t)} · {review.reviewedBy.displayName} · {formatAppDateTime(locale, review.reviewedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}{review.comment ? ` · ${review.comment}` : ""}</p>)}</div> : null}

            {permissions.canReview && (shift.status === "CLOSING" || shift.status === "REVIEW_REQUIRED") ? <div className="mt-4 border-t border-stone-200 pt-4">
              <label className="text-xs font-semibold text-stone-600">{t("cash.reviewComment")}<textarea value={reviewComments[shift.id] ?? ""} maxLength={500} onChange={(event) => setReviewComments((current) => ({ ...current, [shift.id]: event.target.value }))} className="mt-1 min-h-20 w-full rounded-md border border-stone-300 p-3 text-sm" /></label>
              <div className="mt-3 grid grid-cols-2 gap-2 min-[380px]:flex min-[380px]:flex-wrap">
                <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "APPROVED")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white disabled:opacity-50"><ShieldCheck className="h-4 w-4" />{t("cash.approveClose")}</button>
                <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "ADJUSTMENT_REQUIRED")} className="min-h-10 rounded-md border border-amber-300 px-3 text-sm font-semibold text-amber-900 disabled:opacity-50">{t("cash.requestAdjustment")}</button>
                <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "REJECTED")} className="min-h-10 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800 disabled:opacity-50">{t("cash.rejectReview")}</button>
              </div>
              {shift.status === "REVIEW_REQUIRED" ? <button type="button" onClick={() => setAdjustingShiftId(adjustingShiftId === shift.id ? null : shift.id)} className="mt-3 min-h-10 text-sm font-semibold text-teal-800">{adjustingShiftId === shift.id ? t("cash.collapseAdjustment") : t("cash.addAdjustment")}</button> : null}
              {adjustingShiftId === shift.id ? <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end"><SignedMoneyInput label={t("cash.adjustmentAmount")} value={adjustmentAmount} onChange={setAdjustmentAmount} /><TextInput label={t("cash.adjustmentReason")} value={adjustmentReason} onChange={setAdjustmentReason} maxLength={200} /><button type="button" disabled={busy || !adjustmentAmount || Number(adjustmentAmount) === 0 || !adjustmentReason.trim()} onClick={() => void adjustShift()} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{t("cash.submitAdjustment")}</button></div> : null}
            </div> : null}
          </CollapsibleHistoryDetails>
        </article>)}
      </div>
      {filteredHistory.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">{t("cash.noHistory")}</p> : null}
      {filteredHistory.length > 0 ? <CashHistoryPageNavigation locale={locale} t={t} pagination={historyPagination} onPageChange={setHistoryPage} /> : null}
    </section>
  </main>;
}

type OperationsTranslator = ReturnType<typeof useOperationsLocale>["t"];
type OperationsLocale = ReturnType<typeof useOperationsLocale>["locale"];

function CashHistoryPageSizeSelect({
  locale,
  t,
  value,
  onChange,
}: {
  locale: OperationsLocale;
  t: OperationsTranslator;
  value: OperationsPageSize;
  onChange: (value: OperationsPageSize) => void;
}) {
  return <label className="inline-flex items-center gap-2 text-xs font-semibold text-stone-600">
    {t("cash.historyPerPage")}
    <select aria-label={t("cash.historyPageSizeLabel")} value={value} onChange={(event) => onChange(Number(event.target.value) as OperationsPageSize)} className="h-9 rounded-md border border-stone-300 bg-white px-2 text-sm text-stone-900">
      {OPERATIONS_PAGE_SIZES.map((pageSize) => <option key={pageSize} value={pageSize}>{formatAppNumber(locale, pageSize)}</option>)}
    </select>
    {t("cash.historyRecords")}
  </label>;
}

function CashHistoryPageNavigation({
  locale,
  t,
  pagination,
  onPageChange,
}: {
  locale: OperationsLocale;
  t: OperationsTranslator;
  pagination: OperationsPageMeta;
  onPageChange: (page: number) => void;
}) {
  return <nav aria-label={t("cash.historyPagination")} className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm text-stone-600">
    <span>{t("cash.historyRange", {
      first: formatAppNumber(locale, pagination.firstItem),
      last: formatAppNumber(locale, pagination.lastItem),
      total: formatAppNumber(locale, pagination.total),
    })}</span>
    <div className="flex items-center gap-2">
      <button type="button" title={t("cash.historyPrevious")} aria-label={t("cash.historyPrevious")} disabled={pagination.page <= 1} onClick={() => onPageChange(pagination.page - 1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"><ChevronLeft className="h-4 w-4" /></button>
      <span className="min-w-20 text-center text-xs font-semibold text-stone-700">{t("cash.historyPageStatus", {
        page: formatAppNumber(locale, pagination.page),
        total: formatAppNumber(locale, pagination.totalPages),
      })}</span>
      <button type="button" title={t("cash.historyNext")} aria-label={t("cash.historyNext")} disabled={pagination.page >= pagination.totalPages} onClick={() => onPageChange(pagination.page + 1)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300 bg-white disabled:opacity-40"><ChevronRight className="h-4 w-4" /></button>
    </div>
  </nav>;
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`min-w-0 rounded-lg border border-stone-200 bg-white p-3 shadow-sm ${strong ? "col-span-2 border-teal-200 bg-teal-50 min-[380px]:col-span-3 sm:col-span-2 lg:col-span-1" : ""}`}><div className="text-xs text-stone-500">{label}</div><div className={`mt-1 break-words ${strong ? "text-lg font-semibold text-teal-800" : "text-sm font-semibold"}`}>{value}</div></div>;
}

function HistoryMetric({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return <div className="min-w-0 rounded-md bg-stone-50 px-3 py-2"><span className="text-xs text-stone-500">{label}</span><div className={`mt-0.5 break-words font-semibold ${emphasize ? "text-amber-800" : "text-stone-900"}`}>{value}</div></div>;
}

function CollapsibleHistoryDetails({ initiallyOpen, children, t }: { initiallyOpen: boolean; children: ReactNode; t: OperationsTranslator }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group mt-3 border-t border-stone-100 pt-3"><summary className="min-h-10 cursor-pointer rounded-md py-2 text-sm font-semibold text-teal-800 outline-none focus-visible:ring-2 focus-visible:ring-teal-600 group-open:mb-3">{t("cash.viewDetails")}</summary>{children}</details>;
}

function MovementList({ movements, currency, locale, t }: { movements: Movement[]; currency: string; locale: OperationsLocale; t: OperationsTranslator }) {
  const visibleMovements = movements.slice(0, 4);
  const olderMovements = movements.slice(4);
  return <section className="border-t border-stone-200 py-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{t("cash.movementsTitle")}</h2>{movements.length > 0 ? <span className="text-xs text-stone-500">{t("cash.count", { count: movements.length })}</span> : null}</div><div className="mt-3 grid gap-2">{visibleMovements.map((movement) => <MovementRow key={movement.id} movement={movement} currency={currency} locale={locale} t={t} />)}</div>{olderMovements.length > 0 ? <details className="mt-3 rounded-lg border border-stone-200 bg-white p-3"><summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-teal-800 outline-none focus-visible:ring-2 focus-visible:ring-teal-600">{t("cash.olderMovements", { count: olderMovements.length })}</summary><div className="mt-2 grid gap-2">{olderMovements.map((movement) => <MovementRow key={movement.id} movement={movement} currency={currency} locale={locale} t={t} />)}</div></details> : null}{movements.length === 0 ? <p className="py-5 text-sm text-stone-500">{t("cash.noMovements")}</p> : null}</section>;
}

function MovementRow({ movement, currency, locale, t }: { movement: Movement; currency: string; locale: OperationsLocale; t: OperationsTranslator }) {
  const direction = movementDirection(movement);
  return <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-stone-100 bg-white p-3 text-sm min-[380px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[380px]:items-center">{direction >= 0 ? <ArrowDown className="h-4 w-4 text-emerald-700" /> : <ArrowUp className="h-4 w-4 text-red-700" />}<div className="min-w-0"><strong className="break-words">{movementLabel(movement.type, t)} · {movement.reason}</strong><p className="mt-0.5 break-words text-xs text-stone-500">{movement.recordedBy.displayName} · {formatAppDateTime(locale, movement.createdAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" })}</p></div><span className={`col-start-2 font-semibold min-[380px]:col-start-auto ${direction >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedMoney(direction * Math.abs(movement.amount), currency, locale)}</span></div>;
}

function ActionCard({ label, description, icon, disabled, onClick }: { label: string; description: string; icon: ReactNode; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="min-w-0 rounded-lg border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"><span className="text-teal-800">{icon}</span><strong className="mt-2 block break-words text-sm">{label}</strong><span className="mt-1 block break-words text-xs text-stone-500">{description}</span></button>;
}

function CashShiftDialog({ title, description, busy, message, onDismiss, children, t }: { title: string; description: string; busy: boolean; message: string; onDismiss: () => void; children: ReactNode; t: OperationsTranslator }) {
  const dialogRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const focusFrame = window.requestAnimationFrame(() => {
      dialog.querySelector<HTMLElement>("[data-dialog-initial-focus]")?.focus();
    });
    return () => window.cancelAnimationFrame(focusFrame);
  }, []);

  return <dialog ref={dialogRef} aria-labelledby="cash-shift-dialog-title" aria-describedby="cash-shift-dialog-description" onCancel={(event) => { if (busy) event.preventDefault(); }} onClose={onDismiss} data-testid="cash-shift-dialog" className="m-auto max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md overflow-y-auto rounded-xl border border-stone-200 bg-white p-0 text-stone-950 shadow-2xl backdrop:bg-stone-950/60">
    <div className="p-5 sm:p-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0"><h2 id="cash-shift-dialog-title" className="break-words text-xl font-semibold">{title}</h2><p id="cash-shift-dialog-description" className="mt-1 break-words text-sm text-stone-600">{description}</p></div>
        <button type="button" disabled={busy} onClick={onDismiss} aria-label={t("cash.closeDialog", { title })} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-stone-300 text-stone-700 disabled:opacity-50"><X className="h-4 w-4" /></button>
      </div>
      {message ? <p role="status" aria-live="polite" className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">{message}</p> : null}
      <div className="mt-5">{children}</div>
    </div>
  </dialog>;
}

function Variance({ amount, currency, locale, t }: { amount: number; currency: string; locale: OperationsLocale; t: OperationsTranslator }) {
  return <div className={`mt-4 flex items-center justify-between rounded-md px-4 py-3 text-sm font-semibold ${amount === 0 ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}><span>{amount === 0 ? t("cash.variance.match") : amount > 0 ? t("cash.variance.over") : t("cash.variance.short")}</span><span>{formatSignedMoney(amount, currency, locale)}</span></div>;
}

function StatusBadge({ status, t }: { status: ShiftStatus; t: OperationsTranslator }) {
  const labels: Record<ShiftStatus, string> = { OPEN: t("cash.status.open"), CLOSING: t("cash.status.closing"), REVIEW_REQUIRED: t("cash.status.reviewRequired"), CLOSED: t("cash.status.closed") };
  const styles: Record<ShiftStatus, string> = { OPEN: "bg-emerald-50 text-emerald-800", CLOSING: "bg-sky-50 text-sky-800", REVIEW_REQUIRED: "bg-amber-50 text-amber-900", CLOSED: "bg-stone-100 text-stone-700" };
  return <span className={`rounded px-3 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

function MoneyInput({ label, value, onChange, initialFocus = false }: { label: string; value: string; onChange: (value: string) => void; initialFocus?: boolean }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<input data-dialog-initial-focus={initialFocus ? true : undefined} type="text" inputMode="numeric" maxLength={9} pattern="[0-9]{0,9}" value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 9))} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3 text-sm" /></label>;
}

function SignedMoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<input type="text" inputMode="numeric" maxLength={10} pattern="-?[0-9]{0,9}" value={value} onChange={(event) => { const raw = event.target.value; const sign = raw.startsWith("-") ? "-" : ""; onChange(`${sign}${raw.replace(/\D/g, "").slice(0, 9)}`); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3 text-sm" /></label>;
}

function TextInput({ label, value, onChange, maxLength }: { label: string; value: string; onChange: (value: string) => void; maxLength: number }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<input type="text" value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3 text-sm" /></label>;
}

function AuthorizationCodeInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<input type="password" inputMode="numeric" autoComplete="off" value={value} maxLength={8} onChange={(event) => onChange(event.target.value.replace(/\D/g, ""))} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label>;
}

function formatSignedMoney(amount: number, currency: string, locale: OperationsLocale) {
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${formatMoney(Math.abs(amount), currency, locale)}`;
}

function movementDirection(movement: Movement) {
  if (movement.type === "CASH_OUT" || movement.type === "CASH_REFUND") return -1;
  if (movement.type === "CORRECTION") return Math.sign(movement.amount);
  return 1;
}

function movementLabel(type: MovementType, t: OperationsTranslator) {
  const labels: Record<MovementType, string> = { OPENING_FLOAT: t("cash.movement.opening"), CASH_SALE: t("cash.metric.sales"), CASH_REFUND: t("cash.metric.refund"), CASH_IN: t("cash.metric.in"), CASH_OUT: t("cash.metric.out"), CORRECTION: t("cash.metric.adjustment") };
  return labels[type];
}

function reviewDecisionLabel(decision: Review["decision"], t: OperationsTranslator) {
  return { APPROVED: t("cash.review.approved"), REJECTED: t("cash.review.rejected"), ADJUSTMENT_REQUIRED: t("cash.requestAdjustment") }[decision];
}

function offlineCashErrorMessage(code: string, t: OperationsTranslator) {
  const messages: Record<string, string> = {
    OFFLINE_BOOTSTRAP_REQUIRED: t("cash.offline.bootstrapRequired"),
    OFFLINE_PERMIT_EXPIRED: t("cash.offline.permitExpired"),
    OFFLINE_DEVICE_NOT_LEADER: t("cash.offline.notLeader"),
    OFFLINE_ACTION_NOT_ALLOWED: t("cash.offline.notAllowed"),
    OFFLINE_CASH_SHIFT_REQUIRED: t("cash.offline.shiftRequired"),
  };
  return messages[code] ?? (code.startsWith("OFFLINE_")
    ? t("cash.error.offlineGeneric")
    : code);
}
