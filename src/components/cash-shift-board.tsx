"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  CircleDollarSign,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  WalletCards,
  X,
} from "lucide-react";
import { OfflineQueueStatus } from "@/components/offline-queue-status";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatTaipeiDateTime } from "@/lib/date-time";
import { formatMoney } from "@/lib/money";

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

export function CashShiftBoard({
  stall,
  initialState,
  initialPermissions,
}: {
  stall: { id: string; organizationId: string; slug: string; name: string; currency: string };
  initialState: CashShiftState;
  initialPermissions: CashShiftPermissions;
}) {
  const [state, setState] = useState(initialState);
  const [permissions, setPermissions] = useState(initialPermissions);
  const [openingAmount, setOpeningAmount] = useState("");
  const [openNote, setOpenNote] = useState("");
  const [movementType, setMovementType] = useState<"CASH_IN" | "CASH_OUT">("CASH_IN");
  const [movementAmount, setMovementAmount] = useState("");
  const [movementReason, setMovementReason] = useState("");
  const [refundPaymentId, setRefundPaymentId] = useState("");
  const [refundReason, setRefundReason] = useState("");
  const [countedAmount, setCountedAmount] = useState("");
  const [closeNote, setCloseNote] = useState("");
  const [reviewComments, setReviewComments] = useState<Record<string, string>>({});
  const [adjustingShiftId, setAdjustingShiftId] = useState<string | null>(null);
  const [adjustmentAmount, setAdjustmentAmount] = useState("");
  const [adjustmentReason, setAdjustmentReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [activeAction, setActiveAction] = useState<CashShiftAction | null>(null);
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
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新現金交班資料。");
      applyPayload(payload);
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      return false;
    } finally {
      setBusy(false);
    }
  }, [applyPayload, stall.slug]);

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
      "現金班次已開啟。",
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
      }, "現金收支已安全儲存在此裝置，恢復連線後會自動同步。");
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
    }, "現金收支已記錄。")) {
      setMovementAmount("");
      setMovementReason("");
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
    }, "現金退款已記錄。")) {
      setRefundPaymentId("");
      setRefundReason("");
      closeAction();
    }
  }

  async function closeShift() {
    if (!state.openShift) return;
    const amount = Number(countedAmount);
    if (!Number.isInteger(amount) || amount < 0) return;
    const successMessage = permissions.reconciliationEnabled
      ? "盤點已送出，等待店長或老闆複核。"
      : "現金班次已完成交班。";
    if (!navigator.onLine) {
      const saved = await addOfflineCashEvent({
        eventType: "PROVISIONAL_CLOSE",
        amount: activeExpectedAmount,
        countedAmount: amount,
        reason: closeNote.trim() || "離線暫時交班",
      }, "已在此裝置暫時關班；恢復連線同步後，系統會重新計算應有金額並進入複核。");
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
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error instanceof Error
        ? offlineCashErrorMessage(error.message)
        : "目前無法安全儲存離線現金事件。");
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
      setMessage("退回或要求更正時必須填寫原因。");
      return;
    }
    if (await run({ operation: "REVIEW", shiftId, decision, comment }, "複核結果已記錄。")) {
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
    }, "帳務更正已記錄，請重新複核。")) {
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

  return <main className="mx-auto min-h-screen max-w-5xl px-4 py-6 md:px-8">
    <header className="flex items-start justify-between gap-4">
      <div>
        <Link href={`/staff/${stall.slug}`} className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-teal-800">
          <ArrowLeft className="h-4 w-4" />返回訂單看板
        </Link>
        <h1 className="mt-2 text-3xl font-semibold">現金交班與對帳</h1>
        <p className="mt-1 text-sm text-stone-500">{stall.name}</p>
      </div>
      <button type="button" title="重新整理" onClick={() => void refresh()} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-stone-300">
        <RefreshCw className="h-4 w-4" />
      </button>
    </header>

    {!permissions.canManage ? <p className="mt-4 border-l-4 border-stone-300 pl-3 text-sm text-stone-600">目前為唯讀模式，您可以查看現金班次與對帳結果。</p> : null}
    {message && !activeAction ? <p role="status" aria-live="polite" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
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
        <strong>{activeOfflineSnapshot.pendingEvents.length} 筆本機現金事件待同步</strong>
        <p className="mt-1">本機暫算應有金額：{formatMoney(activeExpectedAmount, stall.currency)}。同步時仍由伺服器重新計算並留下差異紀錄。</p>
      </section>
    ) : null}

    {!state.openShift ? <section aria-labelledby="cash-shift-overview-title" className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-4 sm:p-5">
      <div className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-teal-700" /><h2 id="cash-shift-overview-title" className="text-lg font-semibold">現金班次總覽</h2></div>
      <div data-testid="cash-shift-dashboard" className="mt-4 grid grid-cols-2 gap-2 sm:max-w-lg">
        <Metric label="目前狀態" value="尚未開班" />
        <Metric label="交班紀錄" value={`${state.history.length} 筆`} />
      </div>
      {permissions.canManage ? <button type="button" disabled={busy} onClick={() => openAction("OPEN")} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:w-auto"><WalletCards className="h-4 w-4" />開始現金班次</button> : <p className="mt-3 text-sm text-stone-500">目前沒有進行中的現金班次。</p>}
    </section> : <>
      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">進行中的班次</h2><p className="mt-1 text-xs text-stone-500">{state.openShift.openedBy.displayName} · {formatTaipeiDateTime(state.openShift.openedAt)}</p></div><StatusBadge status="OPEN" /></div>
        <div data-testid="cash-shift-dashboard" className="mt-4 grid grid-cols-2 gap-2 min-[380px]:grid-cols-3 sm:grid-cols-4 lg:grid-cols-7">
          <Metric label="開班金額" value={formatMoney(state.openShift.openingAmount, stall.currency)} />
          <Metric label="現金銷售" value={formatMoney(activeOfflineSnapshot?.cashSales ?? state.openShift.cashSales, stall.currency)} />
          <Metric label="現金退款" value={`-${formatMoney(state.openShift.cashRefund, stall.currency)}`} />
          <Metric label="現金收入" value={formatMoney(activeOfflineSnapshot?.cashIn ?? state.openShift.cashIn, stall.currency)} />
          <Metric label="現金支出" value={`-${formatMoney(activeOfflineSnapshot?.cashOut ?? state.openShift.cashOut, stall.currency)}`} />
          <Metric label="帳務更正" value={formatSignedMoney(state.openShift.correction, stall.currency)} />
          <Metric label="系統應有" value={formatMoney(activeExpectedAmount, stall.currency)} strong />
        </div>
      </section>

      {permissions.canManage ? <section aria-labelledby="cash-shift-actions-title" className="mt-7 border-y border-stone-200 py-5">
        <h2 id="cash-shift-actions-title" className="text-lg font-semibold">常用現金操作</h2>
        <div data-testid="cash-shift-actions-dashboard" className="mt-3 grid grid-cols-2 gap-2 min-[380px]:grid-cols-3">
          <ActionCard label="記錄收支" description="收入或支出" icon={<CircleDollarSign className="h-5 w-5" />} disabled={busy || localProvisionalClose} onClick={() => openAction("MOVE")} />
          <ActionCard label="現金退款" description={state.refundablePayments.length > 0 ? `${state.refundablePayments.length} 筆可退款` : "目前無可退款款項"} icon={<RotateCcw className="h-5 w-5" />} disabled={busy || state.refundablePayments.length === 0} onClick={() => openAction("REFUND")} />
          <ActionCard label="盤點交班" description={permissions.reconciliationEnabled ? "送出店長複核" : "完成本班交接"} icon={<CheckCircle2 className="h-5 w-5" />} disabled={busy || localProvisionalClose} onClick={() => openAction("CLOSE")} />
        </div>
      </section> : null}

      <MovementList movements={state.openShift.movements} currency={stall.currency} />
    </>}

    {activeAction === "OPEN" ? <CashShiftDialog title="開啟現金班次" description="輸入錢櫃的開班預備金；備註可留給接班人查看。" busy={busy} message={message} onDismiss={closeAction}>
      <form onSubmit={(event) => { event.preventDefault(); void openShift(); }} className="grid gap-4">
        <MoneyInput label="開班金額" value={openingAmount} onChange={setOpeningAmount} initialFocus />
        <TextInput label="備註（選填）" value={openNote} onChange={setOpenNote} maxLength={500} />
        <button type="submit" disabled={busy || openingAmount === ""} className="min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">開始班次</button>
      </form>
    </CashShiftDialog> : null}

    {activeAction === "MOVE" && state.openShift ? <CashShiftDialog title="記錄現金收支" description="只記錄非訂單產生的現金收入或支出。" busy={busy} message={message} onDismiss={closeAction}>
      <form onSubmit={(event) => { event.preventDefault(); void addMovement(); }} className="grid gap-4">
        <label className="text-xs font-semibold text-stone-600">類型<select data-dialog-initial-focus value={movementType} onChange={(event) => setMovementType(event.target.value as "CASH_IN" | "CASH_OUT")} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="CASH_IN">現金收入</option><option value="CASH_OUT">現金支出</option></select></label>
        <MoneyInput label="金額" value={movementAmount} onChange={setMovementAmount} />
        <TextInput label="原因" value={movementReason} onChange={setMovementReason} maxLength={200} />
        <button type="submit" disabled={busy || localProvisionalClose || !movementAmount || !movementReason.trim()} className="min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">新增紀錄</button>
      </form>
    </CashShiftDialog> : null}

    {activeAction === "REFUND" && state.openShift ? <CashShiftDialog title="現金退款" description="選擇原現金付款，退款後將自動連動本班應有金額。" busy={busy} message={message} onDismiss={closeAction}>
      <form onSubmit={(event) => { event.preventDefault(); void refundPayment(); }} className="grid gap-4">
        <label className="text-xs font-semibold text-stone-600">原付款<select data-dialog-initial-focus value={refundPaymentId} onChange={(event) => setRefundPaymentId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="">請選擇付款</option>{state.refundablePayments.map((payment) => <option key={payment.id} value={payment.id}>{payment.order.orderNo} · {formatMoney(payment.amount, stall.currency)}</option>)}</select></label>
        <TextInput label="退款原因" value={refundReason} onChange={setRefundReason} maxLength={200} />
        <button type="submit" disabled={busy || !refundPaymentId || !refundReason.trim()} className="min-h-11 rounded-md bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">確認退款</button>
      </form>
    </CashShiftDialog> : null}

    {activeAction === "CLOSE" && state.openShift ? <CashShiftDialog title="盤點並交班" description={`系統應有 ${formatMoney(activeExpectedAmount, stall.currency)}，請輸入錢櫃實際盤點金額。`} busy={busy} message={message} onDismiss={closeAction}>
      <form onSubmit={(event) => { event.preventDefault(); void closeShift(); }} className="grid gap-4">
        <MoneyInput label="實際盤點金額" value={countedAmount} onChange={setCountedAmount} initialFocus />
        <TextInput label="交班備註（選填）" value={closeNote} onChange={setCloseNote} maxLength={500} />
        {liveVariance !== null ? <Variance amount={liveVariance} currency={stall.currency} /> : null}
        <button type="submit" disabled={busy || localProvisionalClose || counted === null || counted < 0} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{localProvisionalClose ? "已暫時關班，等待同步" : permissions.reconciliationEnabled ? "送出交班複核" : "完成交班"}</button>
      </form>
    </CashShiftDialog> : null}

    <section className="border-t border-stone-200 py-6">
      <div className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-semibold">交班與複核紀錄</h2></div>
      <div className="mt-3 grid gap-3">
        {state.history.map((shift) => <article key={shift.id} className="min-w-0 rounded-lg border border-stone-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0"><strong>{formatTaipeiDateTime(shift.openedAt)}</strong><p className="mt-1 break-words text-xs text-stone-500">{shift.openedBy.displayName} → {shift.closedBy?.displayName ?? "-"} · {shift.closedAt ? formatTaipeiDateTime(shift.closedAt) : "-"}</p></div>
            <StatusBadge status={shift.status} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-2 text-sm min-[380px]:grid-cols-4">
            <HistoryMetric label="開班" value={formatMoney(shift.openingAmount, stall.currency)} />
            <HistoryMetric label="系統應有" value={formatMoney(shift.systemExpectedAmount ?? 0, stall.currency)} />
            <HistoryMetric label="實際盤點" value={formatMoney(shift.countedAmount ?? 0, stall.currency)} />
            <HistoryMetric label="短溢收" value={formatSignedMoney(shift.varianceAmount ?? 0, stall.currency)} emphasize={(shift.varianceAmount ?? 0) !== 0} />
          </div>
          <CollapsibleHistoryDetails initiallyOpen={shift.status === "CLOSING" || shift.status === "REVIEW_REQUIRED"}>
            {shift.note ? <p className="break-words text-sm text-stone-600">交班備註：{shift.note}</p> : <p className="text-sm text-stone-500">本班沒有交班備註。</p>}
            {shift.reviews.length > 0 ? <div className="mt-4 border-l-2 border-stone-200 pl-3"><h3 className="text-sm font-semibold">複核歷程</h3>{shift.reviews.map((review) => <p key={review.id} className="mt-2 break-words text-xs text-stone-600">{reviewDecisionLabel(review.decision)} · {review.reviewedBy.displayName} · {formatTaipeiDateTime(review.reviewedAt)}{review.comment ? ` · ${review.comment}` : ""}</p>)}</div> : null}

            {permissions.canReview && (shift.status === "CLOSING" || shift.status === "REVIEW_REQUIRED") ? <div className="mt-4 border-t border-stone-200 pt-4">
              <label className="text-xs font-semibold text-stone-600">複核意見<textarea value={reviewComments[shift.id] ?? ""} maxLength={500} onChange={(event) => setReviewComments((current) => ({ ...current, [shift.id]: event.target.value }))} className="mt-1 min-h-20 w-full rounded-md border border-stone-300 p-3 text-sm" /></label>
              <div className="mt-3 grid grid-cols-2 gap-2 min-[380px]:flex min-[380px]:flex-wrap">
                <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "APPROVED")} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white disabled:opacity-50"><ShieldCheck className="h-4 w-4" />核准結班</button>
                <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "ADJUSTMENT_REQUIRED")} className="min-h-10 rounded-md border border-amber-300 px-3 text-sm font-semibold text-amber-900 disabled:opacity-50">要求更正</button>
                <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "REJECTED")} className="min-h-10 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800 disabled:opacity-50">退回複核</button>
              </div>
              {shift.status === "REVIEW_REQUIRED" ? <button type="button" onClick={() => setAdjustingShiftId(adjustingShiftId === shift.id ? null : shift.id)} className="mt-3 min-h-10 text-sm font-semibold text-teal-800">{adjustingShiftId === shift.id ? "收合帳務更正" : "新增帳務更正"}</button> : null}
              {adjustingShiftId === shift.id ? <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end"><SignedMoneyInput label="更正金額（可為負數）" value={adjustmentAmount} onChange={setAdjustmentAmount} /><TextInput label="更正原因" value={adjustmentReason} onChange={setAdjustmentReason} maxLength={200} /><button type="button" disabled={busy || !adjustmentAmount || Number(adjustmentAmount) === 0 || !adjustmentReason.trim()} onClick={() => void adjustShift()} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">送出更正</button></div> : null}
            </div> : null}
          </CollapsibleHistoryDetails>
        </article>)}
      </div>
      {state.history.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">尚無交班紀錄。</p> : null}
    </section>
  </main>;
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className={`min-w-0 rounded-lg border border-stone-200 bg-white p-3 shadow-sm ${strong ? "col-span-2 border-teal-200 bg-teal-50 min-[380px]:col-span-3 sm:col-span-2 lg:col-span-1" : ""}`}><div className="text-xs text-stone-500">{label}</div><div className={`mt-1 break-words ${strong ? "text-lg font-semibold text-teal-800" : "text-sm font-semibold"}`}>{value}</div></div>;
}

function HistoryMetric({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return <div className="min-w-0 rounded-md bg-stone-50 px-3 py-2"><span className="text-xs text-stone-500">{label}</span><div className={`mt-0.5 break-words font-semibold ${emphasize ? "text-amber-800" : "text-stone-900"}`}>{value}</div></div>;
}

function CollapsibleHistoryDetails({ initiallyOpen, children }: { initiallyOpen: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(initiallyOpen);
  return <details open={open} onToggle={(event) => setOpen(event.currentTarget.open)} className="group mt-3 border-t border-stone-100 pt-3"><summary className="min-h-10 cursor-pointer rounded-md py-2 text-sm font-semibold text-teal-800 outline-none focus-visible:ring-2 focus-visible:ring-teal-600 group-open:mb-3">查看交班詳情</summary>{children}</details>;
}

function MovementList({ movements, currency }: { movements: Movement[]; currency: string }) {
  const visibleMovements = movements.slice(0, 4);
  const olderMovements = movements.slice(4);
  return <section className="border-t border-stone-200 py-6"><div className="flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">本班現金明細</h2>{movements.length > 0 ? <span className="text-xs text-stone-500">共 {movements.length} 筆</span> : null}</div><div className="mt-3 grid gap-2">{visibleMovements.map((movement) => <MovementRow key={movement.id} movement={movement} currency={currency} />)}</div>{olderMovements.length > 0 ? <details className="mt-3 rounded-lg border border-stone-200 bg-white p-3"><summary className="min-h-10 cursor-pointer py-2 text-sm font-semibold text-teal-800 outline-none focus-visible:ring-2 focus-visible:ring-teal-600">顯示較早的 {olderMovements.length} 筆明細</summary><div className="mt-2 grid gap-2">{olderMovements.map((movement) => <MovementRow key={movement.id} movement={movement} currency={currency} />)}</div></details> : null}{movements.length === 0 ? <p className="py-5 text-sm text-stone-500">本班尚無現金明細。</p> : null}</section>;
}

function MovementRow({ movement, currency }: { movement: Movement; currency: string }) {
  const direction = movementDirection(movement);
  return <div className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 rounded-lg border border-stone-100 bg-white p-3 text-sm min-[380px]:grid-cols-[auto_minmax(0,1fr)_auto] min-[380px]:items-center">{direction >= 0 ? <ArrowDown className="h-4 w-4 text-emerald-700" /> : <ArrowUp className="h-4 w-4 text-red-700" />}<div className="min-w-0"><strong className="break-words">{movementLabel(movement.type)} · {movement.reason}</strong><p className="mt-0.5 break-words text-xs text-stone-500">{movement.recordedBy.displayName} · {formatTaipeiDateTime(movement.createdAt)}</p></div><span className={`col-start-2 font-semibold min-[380px]:col-start-auto ${direction >= 0 ? "text-emerald-700" : "text-red-700"}`}>{formatSignedMoney(direction * Math.abs(movement.amount), currency)}</span></div>;
}

function ActionCard({ label, description, icon, disabled, onClick }: { label: string; description: string; icon: ReactNode; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="min-w-0 rounded-lg border border-stone-200 bg-white p-3 text-left shadow-sm transition hover:border-teal-300 hover:bg-teal-50 disabled:cursor-not-allowed disabled:opacity-50"><span className="text-teal-800">{icon}</span><strong className="mt-2 block break-words text-sm">{label}</strong><span className="mt-1 block break-words text-xs text-stone-500">{description}</span></button>;
}

function CashShiftDialog({ title, description, busy, message, onDismiss, children }: { title: string; description: string; busy: boolean; message: string; onDismiss: () => void; children: ReactNode }) {
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
        <button type="button" disabled={busy} onClick={onDismiss} aria-label={`關閉${title}`} className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-stone-300 text-stone-700 disabled:opacity-50"><X className="h-4 w-4" /></button>
      </div>
      {message ? <p role="status" aria-live="polite" className="mt-4 rounded-md bg-amber-50 px-3 py-2 text-sm font-medium text-amber-950">{message}</p> : null}
      <div className="mt-5">{children}</div>
    </div>
  </dialog>;
}

function Variance({ amount, currency }: { amount: number; currency: string }) {
  return <div className={`mt-4 flex items-center justify-between rounded-md px-4 py-3 text-sm font-semibold ${amount === 0 ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}><span>{amount === 0 ? "帳款相符" : amount > 0 ? "溢收" : "短收"}</span><span>{formatSignedMoney(amount, currency)}</span></div>;
}

function StatusBadge({ status }: { status: ShiftStatus }) {
  const labels: Record<ShiftStatus, string> = { OPEN: "班次進行中", CLOSING: "等待複核", REVIEW_REQUIRED: "需要更正", CLOSED: "已結班" };
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

function formatSignedMoney(amount: number, currency: string) {
  return `${amount > 0 ? "+" : amount < 0 ? "-" : ""}${formatMoney(Math.abs(amount), currency)}`;
}

function movementDirection(movement: Movement) {
  if (movement.type === "CASH_OUT" || movement.type === "CASH_REFUND") return -1;
  if (movement.type === "CORRECTION") return Math.sign(movement.amount);
  return 1;
}

function movementLabel(type: MovementType) {
  const labels: Record<MovementType, string> = { OPENING_FLOAT: "開班預備金", CASH_SALE: "現金銷售", CASH_REFUND: "現金退款", CASH_IN: "現金收入", CASH_OUT: "現金支出", CORRECTION: "帳務更正" };
  return labels[type];
}

function reviewDecisionLabel(decision: Review["decision"]) {
  return { APPROVED: "核准", REJECTED: "退回", ADJUSTMENT_REQUIRED: "要求更正" }[decision];
}

function offlineCashErrorMessage(code: string) {
  const messages: Record<string, string> = {
    OFFLINE_BOOTSTRAP_REQUIRED: "請先在線上完成此裝置的離線營運初始化。",
    OFFLINE_PERMIT_EXPIRED: "離線營運許可已到期，請恢復連線後重新取得許可。",
    OFFLINE_DEVICE_NOT_LEADER: "此裝置不是目前攤位的離線主裝置。",
    OFFLINE_ACTION_NOT_ALLOWED: "目前的離線許可不允許記錄現金事件。",
    OFFLINE_CASH_SHIFT_REQUIRED: "離線現金操作只能延續已在線上開啟的班別。",
  };
  return messages[code] ?? (code.startsWith("OFFLINE_")
    ? "目前無法安全儲存離線現金事件，請恢復連線後重試。"
    : code);
}
