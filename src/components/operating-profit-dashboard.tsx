"use client";

import { type FormEvent, type ReactNode, useEffect, useState } from "react";
import { Banknote, Boxes, ChevronRight, CircleDollarSign, LoaderCircle, PackageSearch, ReceiptText, TrendingDown, TrendingUp, TriangleAlert, UsersRound, WalletCards, X } from "lucide-react";
import { ReportFilters } from "@/components/report-navigation";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors } from "@/lib/form-field-errors";
import type { getOperatingProfitDashboard } from "@/server/finance/operating-profit-service";

type Dashboard = Awaited<ReturnType<typeof getOperatingProfitDashboard>>;
type ExpenseRecord = Dashboard["expenses"][number];

const expenseLabels: Record<string, string> = {
  RENT: "租金",
  UTILITIES: "水電瓦斯",
  PLATFORM_FEE: "平台／軟體費",
  DELIVERY_FEE: "外送／運輸費",
  MARKETING: "行銷廣告",
  MAINTENANCE: "維修保養",
  EQUIPMENT: "餐具／設備",
  INSURANCE: "保險",
  TAX: "稅費",
  OTHER: "其他",
};

export function OperatingProfitDashboard({
  organizationId,
  initialDashboard,
  canManageExpenses,
  availableStalls,
  multiStallMode,
}: {
  organizationId: string;
  initialDashboard: Dashboard;
  canManageExpenses: boolean;
  availableStalls: Array<{ id: string; name: string }>;
  multiStallMode: boolean;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [selectedExpenseCategory, setSelectedExpenseCategory] = useState("RENT");
  const [correctionTarget, setCorrectionTarget] = useState<ExpenseRecord | null>(null);
  const [correctionCategory, setCorrectionCategory] = useState("RENT");

  useEffect(() => {
    if (!correctionTarget) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) setCorrectionTarget(null);
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [busy, correctionTarget]);

  function openExpenseCorrection(expense: ExpenseRecord) {
    setMessage("");
    setFieldErrors({});
    setCorrectionCategory(expense.category);
    setCorrectionTarget(expense);
  }

  async function createExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const query = new URLSearchParams({ dateFrom: dashboard.dateFrom, dateTo: dashboard.dateTo });
    for (const stall of dashboard.stalls) query.append("stallId", stall.id);
    setBusy(true);
    setMessage("");
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/operating-profit?${query}`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          operation: "CREATE_EXPENSE",
          stallId: data.get("stallId") || null,
          expenseDate: data.get("expenseDate"),
          category: data.get("category"),
          customCategoryName: data.get("category") === "OTHER" ? data.get("customCategoryName") || null : null,
          amount: Math.round(Number(data.get("amount"))),
          vendorName: data.get("vendorName") || null,
          description: data.get("description"),
          isRecurring: data.get("isRecurring") === "on",
        }),
      });
      const payload = await response.json() as Dashboard & { error?: string; fieldErrors?: unknown };
      if (!response.ok || payload.error) {
        setMessage(payload.error ?? "目前無法新增支出。");
        setFieldErrors(parseFieldErrors(payload.fieldErrors));
        return;
      }
      setDashboard(payload);
      setMessage("營業支出已入帳，損益與現金統計已重新計算。");
      form.reset();
      setSelectedExpenseCategory("RENT");
    } catch {
      setMessage("網路連線中斷，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  async function correctExpense(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !correctionTarget) return;
    const data = new FormData(event.currentTarget);
    const query = new URLSearchParams({ dateFrom: dashboard.dateFrom, dateTo: dashboard.dateTo });
    for (const stall of dashboard.stalls) query.append("stallId", stall.id);
    setBusy(true);
    setMessage("");
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/operating-profit?${query}`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          operation: "CORRECT_EXPENSE",
          expenseId: correctionTarget.id,
          correctionReason: data.get("correctionReason"),
          stallId: data.get("stallId") || null,
          expenseDate: data.get("expenseDate"),
          category: data.get("category"),
          customCategoryName: data.get("category") === "OTHER" ? data.get("customCategoryName") || null : null,
          amount: Math.round(Number(data.get("amount"))),
          vendorName: data.get("vendorName") || null,
          description: data.get("description"),
          isRecurring: data.get("isRecurring") === "on",
        }),
      });
      const payload = await response.json() as Dashboard & { error?: string; fieldErrors?: unknown };
      if (!response.ok || payload.error) {
        setMessage(payload.error ?? "目前無法更正支出。");
        setFieldErrors(parseFieldErrors(payload.fieldErrors));
        return;
      }
      setDashboard(payload);
      setCorrectionTarget(null);
      setMessage("支出已更正；原紀錄與更正原因均已保留。損益與現金統計已重新計算。");
    } catch {
      setMessage("網路連線中斷，請稍後再試。");
    } finally {
      setBusy(false);
    }
  }

  const qualityAlerts = [
    dashboard.dataQuality.missingRecipeProducts ? `${dashboard.dataQuality.missingRecipeProducts} 個已售商品缺少配方` : null,
    dashboard.dataQuality.pendingPayrollPeriods ? `${dashboard.dataQuality.pendingPayrollPeriods} 期薪資尚未結案` : null,
    dashboard.dataQuality.negativeInventoryBalances ? `${dashboard.dataQuality.negativeInventoryBalances} 筆庫存為負數` : null,
    dashboard.dataQuality.lotCoverageGaps ? `${dashboard.dataQuality.lotCoverageGaps} 個效期品庫位的庫存與批號量不一致` : null,
    dashboard.dataQuality.expiringLots ? `${dashboard.dataQuality.expiringLots} 批庫存 7 天內到期` : null,
    dashboard.dataQuality.expiredLots ? `${dashboard.dataQuality.expiredLots} 批庫存已過期` : null,
    dashboard.stalls.length < availableStalls.length && (dashboard.summary.sharedOperatingExpenseAmount || dashboard.summary.sharedPurchaseSpend)
      ? `目前範圍包含 ${money(dashboard.summary.sharedOperatingExpenseAmount + dashboard.summary.sharedPurchaseSpend)} 組織共用成本，尚未分攤至各攤位`
      : null,
  ].filter(Boolean) as string[];

  return <div className="space-y-6">
    <ReportFilters
      organizationId={organizationId}
      stalls={availableStalls}
      selectedStallIds={dashboard.stalls.map((stall) => stall.id)}
      dateFrom={dashboard.dateFrom}
      dateTo={dashboard.dateTo}
      multiStallMode={multiStallMode}
      showExport={false}
    />

    <section aria-label="營運損益摘要" className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-9">
      <Metric icon={CircleDollarSign} label="淨營收" value={money(dashboard.summary.netSales)} />
      <Metric icon={TrendingUp} label="毛利" value={money(dashboard.summary.grossProfit)} hint={percent(dashboard.summary.grossMarginBasisPoints)} />
      <Metric icon={PackageSearch} label="食材成本" value={money(dashboard.summary.foodCost)} />
      <Metric icon={PackageSearch} label="一次性包材成本" value={money(dashboard.summary.packagingCost)} />
      <Metric icon={UsersRound} label="已結案薪資" value={money(dashboard.summary.payrollCost)} hint={percent(dashboard.summary.laborCostBasisPoints)} />
      <Metric icon={ReceiptText} label="其他營業支出" value={money(dashboard.summary.operatingExpenseAmount)} />
      <Metric icon={dashboard.summary.operatingProfit >= 0 ? TrendingUp : TrendingDown} label="營業利益" value={money(dashboard.summary.operatingProfit)} hint={percent(dashboard.summary.operatingProfitBasisPoints)} negative={dashboard.summary.operatingProfit < 0} />
      <Metric icon={WalletCards} label="本期現金淨流量" value={money(dashboard.summary.netCashMovement)} negative={dashboard.summary.netCashMovement < 0} />
      <Metric icon={Boxes} label="期末庫存估值" value={money(dashboard.summary.inventoryValue)} />
    </section>

    {qualityAlerts.length ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h2 className="flex items-center gap-2 font-semibold text-amber-950"><TriangleAlert className="h-5 w-5" />報表可信度待處理</h2><ul className="mt-2 grid gap-2 text-sm text-amber-950 sm:grid-cols-2">{qualityAlerts.map((alert) => <li key={alert} className="rounded-md bg-white/70 p-2">{alert}</li>)}</ul></section> : null}
    {message ? <p role="status" className={`rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length || message.includes("無法") ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}

    <section className="grid gap-4 lg:grid-cols-2">
      <CollapsiblePanel testId="operating-profit-pnl" title="月度實際營運損益"><dl className="divide-y divide-stone-200 text-sm"><PnlRow label="淨營收" value={dashboard.summary.netSales} /><PnlRow label="－ 食材成本" value={-dashboard.summary.foodCost} /><PnlRow label="－ 一次性包材成本" value={-dashboard.summary.packagingCost} /><PnlRow label="＝ 毛利" value={dashboard.summary.grossProfit} strong /><PnlRow label="－ 已結案員工薪資" value={-dashboard.summary.payrollCost} /><PnlRow label="－ 租金、水電與其他支出" value={-dashboard.summary.operatingExpenseAmount} /><PnlRow label="＝ 營業利益" value={dashboard.summary.operatingProfit} strong /></dl><p className="mt-3 text-xs leading-5 text-stone-500">一次性餐盒、紙袋會依訂單計入包材成本；內用餐盤、餐具與設備不會逐單扣除，請依實際購置方式記錄在餐具／設備支出。</p></CollapsiblePanel>
      <CollapsiblePanel testId="operating-profit-cash-flow" title="本期現金收支"><dl className="divide-y divide-stone-200 text-sm"><PnlRow label="已收款" value={dashboard.summary.cashCollected} /><PnlRow label="－ 進貨付款／到貨金額" value={-dashboard.summary.purchaseSpend} /><PnlRow label="－ 已結案員工薪資" value={-dashboard.summary.payrollCost} /><PnlRow label="－ 其他營業支出" value={-dashboard.summary.operatingExpenseAmount} /><PnlRow label="＝ 現金淨流量" value={dashboard.summary.netCashMovement} strong /></dl><div className="mt-4 grid grid-cols-2 gap-2"><Mini label="主要成本率" value={percent(dashboard.summary.primeCostBasisPoints)} /><Mini label="報廢耗損" value={money(dashboard.summary.wasteCost)} /></div></CollapsiblePanel>
    </section>

    {canManageExpenses ? <details className="group rounded-xl border border-stone-200 bg-white shadow-sm">
      <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold"><span className="flex items-center gap-2"><Banknote className="h-5 w-5" />新增水電、租金或其他支出</span><span className="transition-transform group-open:rotate-180">⌄</span></summary>
      <form onSubmit={createExpense} className="border-t border-stone-200 p-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label="歸屬攤位" name="stallId" required={false} options={[["", "組織共用"], ...dashboard.stalls.map((stall) => [stall.id, stall.name] as const)]} error={fieldErrors.stallId} />
          <Field label="支出日期" name="expenseDate" type="date" defaultValue={dashboard.dateTo} error={fieldErrors.expenseDate} />
          <SelectField label="分類" name="category" options={Object.entries(expenseLabels)} error={fieldErrors.category} value={selectedExpenseCategory} onChange={(event) => setSelectedExpenseCategory(event.currentTarget.value)} />
          {selectedExpenseCategory === "OTHER" ? <Field label="其他支出品項" name="customCategoryName" list="custom-expense-category-names" placeholder="例：瓦斯罐" error={fieldErrors.customCategoryName} /> : null}
          <datalist id="custom-expense-category-names">{dashboard.customExpenseCategoryNames.map((name) => <option key={name} value={name} />)}</datalist>
          <Field label="金額" name="amount" type="number" min="1" step="1" error={fieldErrors.amount} />
          <Field label="收款方（選填）" name="vendorName" required={false} error={fieldErrors.vendorName} />
          <Field label="支出說明" name="description" placeholder="例：8 月電費" error={fieldErrors.description} />
          <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-stone-300 px-3 text-sm font-medium"><input type="checkbox" name="isRecurring" className="h-5 w-5" />固定週期支出</label>
        </div>
        <p className="mt-3 text-xs leading-5 text-stone-500">「其他」品項只會保留在這個商家的歷史建議中，不會自動變成所有商家的分類。</p>
        <button type="submit" disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}新增支出</button>
      </form>
    </details> : null}

    {canManageExpenses ? <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <h2 className="text-lg font-semibold text-stone-950">已入帳支出</h2>
      <p className="mt-1 text-sm leading-6 text-stone-600">點選一筆支出即可更正。系統會保留原紀錄與更正原因，不會直接覆蓋或刪除帳務。</p>
      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {dashboard.expenses.map((expense) => (
          <button type="button" key={expense.id} data-testid={`correct-operating-expense-${expense.id}`} onClick={() => openExpenseCorrection(expense)} className="group flex min-h-28 w-full items-center justify-between gap-3 rounded-xl border-2 border-stone-200 p-4 text-left transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">
            <span className="min-w-0"><span className="block text-xs text-stone-500">{expense.expenseDate} · {expense.stallId ? dashboard.stalls.find((stall) => stall.id === expense.stallId)?.name ?? "未知攤位" : "組織共用"}</span><strong className="mt-1 block text-base text-stone-950">{expense.category === "OTHER" && expense.customCategoryName ? `其他：${expense.customCategoryName}` : expenseLabels[expense.category] ?? expense.category}</strong><span className="mt-1 block truncate text-sm text-stone-600">{expense.description}</span><span className="mt-2 block text-lg font-semibold text-stone-950">{money(expense.amount)}</span></span>
            <ChevronRight className="h-6 w-6 shrink-0 text-stone-400 group-hover:text-teal-700" aria-hidden="true" />
          </button>
        ))}
        {!dashboard.expenses.length ? <p className="text-sm text-stone-600">此區間尚無可更正的營業支出。</p> : null}
      </div>
    </section> : null}

    {correctionTarget ? <ExpenseCorrectionDialog
      target={correctionTarget}
      stalls={dashboard.stalls}
      category={correctionCategory}
      onCategoryChange={setCorrectionCategory}
      fieldErrors={fieldErrors}
      message={message}
      busy={busy}
      onClose={() => { if (!busy) setCorrectionTarget(null); }}
      onSubmit={correctExpense}
    /> : null}

    <section className="grid gap-4 lg:grid-cols-2"><CollapsiblePanel testId="operating-profit-expense-categories" title="支出分類"><div className="space-y-2">{dashboard.expenseCategories.map((row) => <div key={`${row.category}:${row.customCategoryName ?? ""}`} className="flex justify-between rounded-lg border border-stone-200 p-3 text-sm"><span>{row.category === "OTHER" && row.customCategoryName ? `其他：${row.customCategoryName}` : expenseLabels[row.category] ?? row.category}</span><strong>{money(row.amount)}</strong></div>)}{!dashboard.expenseCategories.length ? <p className="text-sm text-stone-600">此區間尚無其他營業支出。</p> : null}</div></CollapsiblePanel><CollapsiblePanel testId="operating-profit-daily-sales" title="每日淨營收"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3">{dashboard.dailySales.map((row) => <div key={row.businessDate} className="rounded-lg border border-stone-200 p-3"><p className="text-xs text-stone-500">{row.businessDate}</p><strong className="mt-1 block">{money(row.netSales)}</strong></div>)}{!dashboard.dailySales.length ? <p className="text-sm text-stone-600">此區間尚無完成訂單。</p> : null}</div></CollapsiblePanel></section>

    <CollapsiblePanel testId="operating-profit-product-margins" title="商品毛利排行"><div className="overflow-x-auto"><table className="w-full min-w-[800px] text-left text-sm"><thead><tr className="border-b border-stone-200 text-stone-600"><th className="p-2">商品</th><th className="p-2 text-right">銷量</th><th className="p-2 text-right">營收</th><th className="p-2 text-right">食材</th><th className="p-2 text-right">一次性包材</th><th className="p-2 text-right">估計成本</th><th className="p-2 text-right">毛利</th><th className="p-2 text-right">毛利率</th></tr></thead><tbody>{dashboard.productMargins.map((row) => <tr key={`${row.productId}-${row.productName}`} className="border-b border-stone-100"><td className="p-2 font-medium">{row.productName}</td><td className="p-2 text-right">{row.quantity}</td><td className="p-2 text-right">{money(row.revenue)}</td><td className="p-2 text-right">{money(row.foodCost)}</td><td className="p-2 text-right">{money(row.packagingCost)}</td><td className="p-2 text-right">{money(row.estimatedCost)}</td><td className="p-2 text-right">{money(row.grossProfit)}</td><td className="p-2 text-right font-semibold">{percent(row.grossMarginBasisPoints)}</td></tr>)}</tbody></table>{!dashboard.productMargins.length ? <p className="py-8 text-center text-sm text-stone-600">此區間尚無可計算商品。</p> : null}</div></CollapsiblePanel>
  </div>;
}

function ExpenseCorrectionDialog({
  target,
  stalls,
  category,
  onCategoryChange,
  fieldErrors,
  message,
  busy,
  onClose,
  onSubmit,
}: {
  target: ExpenseRecord;
  stalls: Array<{ id: string; name: string }>;
  category: string;
  onCategoryChange: (category: string) => void;
  fieldErrors: Record<string, string>;
  message: string;
  busy: boolean;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  return <div className="fixed inset-0 z-[90] overflow-y-auto bg-black/60" data-testid="operating-expense-correction-dialog">
    <div className="flex min-h-full items-stretch justify-center sm:items-start sm:p-4">
      <section role="dialog" aria-modal="true" aria-labelledby="operating-expense-correction-title" className="flex min-h-dvh w-full max-w-3xl flex-col bg-stone-50 shadow-2xl sm:min-h-0 sm:max-h-[calc(100vh-2rem)] sm:rounded-2xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white p-4 sm:rounded-t-2xl sm:p-5">
          <div><h2 id="operating-expense-correction-title" className="text-xl font-semibold text-stone-950">更正已入帳支出</h2><p className="mt-1 text-sm leading-6 text-stone-600">原紀錄會保留；儲存後會建立一筆更正版並重新計算報表。</p></div>
          <button type="button" autoFocus disabled={busy} onClick={onClose} aria-label="關閉更正視窗" className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200 disabled:opacity-50"><X className="h-6 w-6" aria-hidden="true" /></button>
        </header>
        <form onSubmit={onSubmit} className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm leading-6 text-amber-950"><strong>原支出：</strong>{target.expenseDate} · {target.description} · {money(target.amount)}</div>
          {message ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</p> : null}
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <SelectField label="歸屬攤位" name="stallId" required={false} defaultValue={target.stallId ?? ""} options={[["", "組織共用"], ...stalls.map((stall) => [stall.id, stall.name] as const)]} error={fieldErrors.stallId} />
            <Field label="支出日期" name="expenseDate" type="date" defaultValue={target.expenseDate} error={fieldErrors.expenseDate} />
            <SelectField label="分類" name="category" options={Object.entries(expenseLabels)} error={fieldErrors.category} value={category} onChange={(event) => onCategoryChange(event.currentTarget.value)} />
            {category === "OTHER" ? <Field label="其他支出品項" name="customCategoryName" list="custom-expense-category-names" defaultValue={target.customCategoryName ?? ""} error={fieldErrors.customCategoryName} /> : null}
            <Field label="金額" name="amount" type="number" min="1" step="1" defaultValue={target.amount} error={fieldErrors.amount} />
            <Field label="收款方（選填）" name="vendorName" required={false} defaultValue={target.vendorName ?? ""} error={fieldErrors.vendorName} />
            <Field label="支出說明" name="description" defaultValue={target.description} error={fieldErrors.description} />
            <label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-stone-300 bg-white px-3 text-sm font-medium"><input type="checkbox" name="isRecurring" defaultChecked={target.isRecurring} className="h-5 w-5" />固定週期支出</label>
            <label className="grid gap-1 text-sm font-medium sm:col-span-2">更正原因<textarea name="correctionReason" required minLength={2} maxLength={300} aria-invalid={Boolean(fieldErrors.correctionReason)} aria-describedby={fieldErrors.correctionReason ? "correctionReason-error" : undefined} placeholder="例：原金額輸入錯誤，依發票更正" className="min-h-24 rounded-md border border-stone-300 bg-white p-3" />{fieldErrors.correctionReason ? <span id="correctionReason-error" className="text-sm text-red-700">{fieldErrors.correctionReason}</span> : null}</label>
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <button type="button" disabled={busy} onClick={onClose} className="min-h-12 rounded-xl border-2 border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 disabled:opacity-50">取消</button>
            <button type="submit" disabled={busy} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}儲存更正</button>
          </div>
        </form>
      </section>
    </div>
  </div>;
}

function Metric({ icon: Icon, label, value, hint, negative = false }: { icon: typeof CircleDollarSign; label: string; value: string; hint?: string; negative?: boolean }) { return <article className="min-w-0 rounded-xl border border-stone-200 bg-white p-3 shadow-sm"><div className="flex items-center gap-1.5 text-xs text-stone-600"><Icon className="h-4 w-4 text-teal-700" />{label}</div><p className={`mt-2 break-words text-lg font-semibold tabular-nums ${negative ? "text-red-700" : "text-stone-950"}`}>{value}</p>{hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}</article>; }
function CollapsiblePanel({ testId, title, children }: { testId: string; title: string; children: ReactNode }) { return <details open data-testid={testId} className="group rounded-xl border border-stone-200 bg-white shadow-sm"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 font-semibold [&::-webkit-details-marker]:hidden"><h2 className="text-lg font-semibold">{title}</h2><span aria-hidden="true" className="text-stone-500 transition-transform group-open:rotate-180">⌄</span></summary><div className="border-t border-stone-200 p-4">{children}</div></details>; }
function PnlRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) { return <div className={`flex justify-between gap-3 py-3 ${strong ? "font-semibold" : ""}`}><dt>{label}</dt><dd className={value < 0 ? "text-red-700" : ""}>{money(value)}</dd></div>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-stone-50 p-3"><p className="text-xs text-stone-500">{label}</p><strong className="mt-1 block">{value}</strong></div>; }
function Field({ label, name, error, required = true, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string }) { const errorId = `${name}-error`; return <label className="grid gap-1 text-sm font-medium">{label}<input type={type} name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...props} className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3" />{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>; }
function SelectField({ label, name, options, error, required = true, value, defaultValue, onChange }: { label: string; name: string; options: readonly (readonly [string, string])[]; error?: string; required?: boolean; value?: string; defaultValue?: string; onChange?: React.ChangeEventHandler<HTMLSelectElement> }) { const errorId = `${name}-error`; return <label className="grid gap-1 text-sm font-medium">{label}<select name={name} required={required} value={value} defaultValue={defaultValue} onChange={onChange} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className="min-h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3">{options.map(([optionValue, optionLabel]) => <option key={optionValue} value={optionValue}>{optionLabel}</option>)}</select>{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>; }
function money(value: number) { const sign = value < 0 ? "−" : ""; return `${sign}${new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Math.abs(value))}`; }
function percent(basisPoints: number) { return `${(basisPoints / 100).toFixed(1)}%`; }
