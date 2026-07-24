"use client";

import { useCallback, useEffect, useState } from "react";
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
} from "lucide-react";
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

export function CashShiftBoard({
  stall,
  initialState,
  initialPermissions,
}: {
  stall: { slug: string; name: string; currency: string };
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

  const applyPayload = useCallback((payload: { state?: CashShiftState; permissions?: CashShiftPermissions }) => {
    if (payload.state) setState(payload.state);
    if (payload.permissions) setPermissions(payload.permissions);
  }, []);

  const refresh = useCallback(async () => {
    const response = await fetch(`/api/stalls/${stall.slug}/cash-shifts`, { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) applyPayload(payload);
  }, [applyPayload, stall.slug]);

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

  async function openShift() {
    const amount = Number(openingAmount);
    if (!Number.isInteger(amount) || amount < 0) return;
    if (await run(
      { operation: "OPEN", openingAmount: amount, note: openNote.trim() || null },
      "現金班次已開啟。",
    )) {
      setOpeningAmount("");
      setOpenNote("");
    }
  }

  async function addMovement() {
    if (!state.openShift) return;
    const amount = Number(movementAmount);
    if (!Number.isInteger(amount) || amount <= 0 || !movementReason.trim()) return;
    if (await run({
      operation: "MOVE",
      shiftId: state.openShift.id,
      type: movementType,
      amount,
      reason: movementReason.trim(),
    }, "現金收支已記錄。")) {
      setMovementAmount("");
      setMovementReason("");
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
    }
  }

  async function closeShift() {
    if (!state.openShift) return;
    const amount = Number(countedAmount);
    if (!Number.isInteger(amount) || amount < 0) return;
    const successMessage = permissions.reconciliationEnabled
      ? "盤點已送出，等待店長或老闆複核。"
      : "現金班次已完成交班。";
    if (await run({
      operation: "CLOSE",
      shiftId: state.openShift.id,
      countedAmount: amount,
      note: closeNote.trim() || null,
    }, successMessage)) {
      setCountedAmount("");
      setCloseNote("");
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

  const counted = countedAmount === "" ? null : Number(countedAmount);
  const liveVariance = state.openShift && counted !== null && Number.isFinite(counted)
    ? counted - state.openShift.expectedAmount
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
    {message ? <p role="status" aria-live="polite" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}

    {!state.openShift ? <section className="mt-6 border-y border-stone-200 py-6">
      <div className="flex items-center gap-2"><WalletCards className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-semibold">開啟現金班次</h2></div>
      {permissions.canManage ? <div className="mt-4 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end">
        <MoneyInput label="開班金額" value={openingAmount} onChange={setOpeningAmount} />
        <TextInput label="備註（選填）" value={openNote} onChange={setOpenNote} maxLength={500} />
        <button type="button" disabled={busy || openingAmount === ""} onClick={() => void openShift()} className="h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">開始班次</button>
      </div> : <p className="mt-3 text-sm text-stone-500">目前沒有進行中的現金班次。</p>}
    </section> : <>
      <section className="mt-6">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-xl font-semibold">進行中的班次</h2><p className="mt-1 text-xs text-stone-500">{state.openShift.openedBy.displayName} · {formatTaipeiDateTime(state.openShift.openedAt)}</p></div><StatusBadge status="OPEN" /></div>
        <div className="mt-4 grid grid-cols-2 border-l border-t border-stone-200 sm:grid-cols-3 lg:grid-cols-7">
          <Metric label="開班金額" value={formatMoney(state.openShift.openingAmount, stall.currency)} />
          <Metric label="現金銷售" value={formatMoney(state.openShift.cashSales, stall.currency)} />
          <Metric label="現金退款" value={`-${formatMoney(state.openShift.cashRefund, stall.currency)}`} />
          <Metric label="現金收入" value={formatMoney(state.openShift.cashIn, stall.currency)} />
          <Metric label="現金支出" value={`-${formatMoney(state.openShift.cashOut, stall.currency)}`} />
          <Metric label="帳務更正" value={formatSignedMoney(state.openShift.correction, stall.currency)} />
          <Metric label="系統應有" value={formatMoney(state.openShift.expectedAmount, stall.currency)} strong />
        </div>
      </section>

      {permissions.canManage ? <>
        <section className="mt-7 border-y border-stone-200 py-5">
          <h2 className="text-lg font-semibold">記錄現金收支</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-[140px_160px_minmax(0,1fr)_auto] sm:items-end">
            <label className="text-xs font-semibold text-stone-600">類型<select value={movementType} onChange={(event) => setMovementType(event.target.value as "CASH_IN" | "CASH_OUT")} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="CASH_IN">現金收入</option><option value="CASH_OUT">現金支出</option></select></label>
            <MoneyInput label="金額" value={movementAmount} onChange={setMovementAmount} />
            <TextInput label="原因" value={movementReason} onChange={setMovementReason} maxLength={200} />
            <button type="button" disabled={busy || !movementAmount || !movementReason.trim()} onClick={() => void addMovement()} className="h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">新增紀錄</button>
          </div>
        </section>

        <section className="border-b border-stone-200 py-5">
          <div className="flex items-center gap-2"><RotateCcw className="h-5 w-5 text-teal-700" /><h2 className="text-lg font-semibold">現金退款</h2></div>
          {state.refundablePayments.length > 0 ? <div className="mt-3 grid gap-3 sm:grid-cols-[minmax(220px,1fr)_minmax(0,1fr)_auto] sm:items-end">
            <label className="text-xs font-semibold text-stone-600">原付款<select value={refundPaymentId} onChange={(event) => setRefundPaymentId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="">請選擇付款</option>{state.refundablePayments.map((payment) => <option key={payment.id} value={payment.id}>{payment.order.orderNo} · {formatMoney(payment.amount, stall.currency)}</option>)}</select></label>
            <TextInput label="退款原因" value={refundReason} onChange={setRefundReason} maxLength={200} />
            <button type="button" disabled={busy || !refundPaymentId || !refundReason.trim()} onClick={() => void refundPayment()} className="h-11 rounded-md border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">確認退款</button>
          </div> : <p className="mt-3 text-sm text-stone-500">目前沒有可退款的現金付款。</p>}
        </section>

        <section className="py-6">
          <h2 className="text-xl font-semibold">盤點並交班</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)]"><MoneyInput label="實際盤點金額" value={countedAmount} onChange={setCountedAmount} /><TextInput label="交班備註（選填）" value={closeNote} onChange={setCloseNote} maxLength={500} /></div>
          {liveVariance !== null ? <Variance amount={liveVariance} currency={stall.currency} /> : null}
          <button type="button" disabled={busy || counted === null || counted < 0} onClick={() => void closeShift()} className="mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50"><CheckCircle2 className="h-4 w-4" />{permissions.reconciliationEnabled ? "送出交班複核" : "完成交班"}</button>
        </section>
      </> : null}

      <MovementList movements={state.openShift.movements} currency={stall.currency} />
    </>}

    <section className="border-t border-stone-200 py-6">
      <div className="flex items-center gap-2"><CircleDollarSign className="h-5 w-5 text-teal-700" /><h2 className="text-xl font-semibold">交班與複核紀錄</h2></div>
      <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
        {state.history.map((shift) => <article key={shift.id} className="py-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div><strong>{formatTaipeiDateTime(shift.openedAt)}</strong><p className="mt-1 text-xs text-stone-500">{shift.openedBy.displayName} → {shift.closedBy?.displayName ?? "-"} · {shift.closedAt ? formatTaipeiDateTime(shift.closedAt) : "-"}</p></div>
            <StatusBadge status={shift.status} />
          </div>
          <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
            <HistoryMetric label="開班" value={formatMoney(shift.openingAmount, stall.currency)} />
            <HistoryMetric label="系統應有" value={formatMoney(shift.systemExpectedAmount ?? 0, stall.currency)} />
            <HistoryMetric label="實際盤點" value={formatMoney(shift.countedAmount ?? 0, stall.currency)} />
            <HistoryMetric label="短溢收" value={formatSignedMoney(shift.varianceAmount ?? 0, stall.currency)} emphasize={(shift.varianceAmount ?? 0) !== 0} />
          </div>
          {shift.note ? <p className="mt-3 text-sm text-stone-600">交班備註：{shift.note}</p> : null}
          {shift.reviews.length > 0 ? <div className="mt-4 border-l-2 border-stone-200 pl-3"><h3 className="text-sm font-semibold">複核歷程</h3>{shift.reviews.map((review) => <p key={review.id} className="mt-2 text-xs text-stone-600">{reviewDecisionLabel(review.decision)} · {review.reviewedBy.displayName} · {formatTaipeiDateTime(review.reviewedAt)}{review.comment ? ` · ${review.comment}` : ""}</p>)}</div> : null}

          {permissions.canReview && (shift.status === "CLOSING" || shift.status === "REVIEW_REQUIRED") ? <div className="mt-4 border-t border-stone-200 pt-4">
            <label className="text-xs font-semibold text-stone-600">複核意見<textarea value={reviewComments[shift.id] ?? ""} maxLength={500} onChange={(event) => setReviewComments((current) => ({ ...current, [shift.id]: event.target.value }))} className="mt-1 min-h-20 w-full rounded-md border border-stone-300 p-3 text-sm" /></label>
            <div className="mt-3 flex flex-wrap gap-2">
              <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "APPROVED")} className="inline-flex h-10 items-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white disabled:opacity-50"><ShieldCheck className="h-4 w-4" />核准結班</button>
              <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "ADJUSTMENT_REQUIRED")} className="h-10 rounded-md border border-amber-300 px-3 text-sm font-semibold text-amber-900 disabled:opacity-50">要求更正</button>
              <button type="button" disabled={busy} onClick={() => void reviewShift(shift.id, "REJECTED")} className="h-10 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-800 disabled:opacity-50">退回複核</button>
            </div>
            {shift.status === "REVIEW_REQUIRED" ? <button type="button" onClick={() => setAdjustingShiftId(adjustingShiftId === shift.id ? null : shift.id)} className="mt-3 text-sm font-semibold text-teal-800">{adjustingShiftId === shift.id ? "收合帳務更正" : "新增帳務更正"}</button> : null}
            {adjustingShiftId === shift.id ? <div className="mt-3 grid gap-3 sm:grid-cols-[180px_minmax(0,1fr)_auto] sm:items-end"><SignedMoneyInput label="更正金額（可為負數）" value={adjustmentAmount} onChange={setAdjustmentAmount} /><TextInput label="更正原因" value={adjustmentReason} onChange={setAdjustmentReason} maxLength={200} /><button type="button" disabled={busy || !adjustmentAmount || Number(adjustmentAmount) === 0 || !adjustmentReason.trim()} onClick={() => void adjustShift()} className="h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">送出更正</button></div> : null}
          </div> : null}
        </article>)}
      </div>
      {state.history.length === 0 ? <p className="py-8 text-center text-sm text-stone-500">尚無交班紀錄。</p> : null}
    </section>
  </main>;
}

function Metric({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return <div className="min-w-0 border-b border-r border-stone-200 p-3"><div className="text-xs text-stone-500">{label}</div><div className={`mt-1 break-words ${strong ? "text-lg font-semibold text-teal-800" : "text-sm font-semibold"}`}>{value}</div></div>;
}

function HistoryMetric({ label, value, emphasize = false }: { label: string; value: string; emphasize?: boolean }) {
  return <div><span className="text-xs text-stone-500">{label}</span><div className={`mt-0.5 font-semibold ${emphasize ? "text-amber-800" : "text-stone-900"}`}>{value}</div></div>;
}

function MovementList({ movements, currency }: { movements: Movement[]; currency: string }) {
  return <section className="border-t border-stone-200 py-6"><h2 className="text-lg font-semibold">本班現金明細</h2><div className="mt-3 divide-y divide-stone-100">{movements.map((movement) => {
    const direction = movementDirection(movement);
    return <div key={movement.id} className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-3 py-3 text-sm">{direction >= 0 ? <ArrowDown className="h-4 w-4 text-emerald-700" /> : <ArrowUp className="h-4 w-4 text-red-700" />}<div className="min-w-0"><strong>{movementLabel(movement.type)} · {movement.reason}</strong><p className="mt-0.5 text-xs text-stone-500">{movement.recordedBy.displayName} · {formatTaipeiDateTime(movement.createdAt)}</p></div><span className={direction >= 0 ? "text-emerald-700" : "text-red-700"}>{formatSignedMoney(direction * Math.abs(movement.amount), currency)}</span></div>;
  })}</div>{movements.length === 0 ? <p className="py-5 text-sm text-stone-500">本班尚無現金明細。</p> : null}</section>;
}

function Variance({ amount, currency }: { amount: number; currency: string }) {
  return <div className={`mt-4 flex items-center justify-between rounded-md px-4 py-3 text-sm font-semibold ${amount === 0 ? "bg-emerald-50 text-emerald-900" : "bg-amber-50 text-amber-950"}`}><span>{amount === 0 ? "帳款相符" : amount > 0 ? "溢收" : "短收"}</span><span>{formatSignedMoney(amount, currency)}</span></div>;
}

function StatusBadge({ status }: { status: ShiftStatus }) {
  const labels: Record<ShiftStatus, string> = { OPEN: "班次進行中", CLOSING: "等待複核", REVIEW_REQUIRED: "需要更正", CLOSED: "已結班" };
  const styles: Record<ShiftStatus, string> = { OPEN: "bg-emerald-50 text-emerald-800", CLOSING: "bg-sky-50 text-sky-800", REVIEW_REQUIRED: "bg-amber-50 text-amber-900", CLOSED: "bg-stone-100 text-stone-700" };
  return <span className={`rounded px-3 py-1 text-xs font-semibold ${styles[status]}`}>{labels[status]}</span>;
}

function MoneyInput({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<input type="text" inputMode="numeric" maxLength={9} pattern="[0-9]{0,9}" value={value} onChange={(event) => onChange(event.target.value.replace(/\D/g, "").slice(0, 9))} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3 text-sm" /></label>;
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
