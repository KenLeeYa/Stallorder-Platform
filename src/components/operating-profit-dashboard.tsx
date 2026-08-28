"use client";

import { type FormEvent, useState } from "react";
import { Banknote, Boxes, CircleDollarSign, LoaderCircle, PackageSearch, ReceiptText, TrendingDown, TrendingUp, TriangleAlert, UsersRound, WalletCards } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors } from "@/lib/form-field-errors";
import type { getOperatingProfitDashboard } from "@/server/finance/operating-profit-service";

type Dashboard = Awaited<ReturnType<typeof getOperatingProfitDashboard>>;

const expenseLabels: Record<string, string> = {
  RENT: "租金",
  UTILITIES: "水電瓦斯",
  PLATFORM_FEE: "平台／軟體費",
  DELIVERY_FEE: "外送／運輸費",
  MARKETING: "行銷廣告",
  MAINTENANCE: "維修保養",
  INSURANCE: "保險",
  TAX: "稅費",
  OTHER: "其他",
};

export function OperatingProfitDashboard({
  organizationId,
  initialDashboard,
  canManageExpenses,
  availableStalls,
}: {
  organizationId: string;
  initialDashboard: Dashboard;
  canManageExpenses: boolean;
  availableStalls: Array<{ id: string; name: string }>;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

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
    <form method="get" className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_2fr_auto]"><Field label="開始日" name="dateFrom" type="date" defaultValue={dashboard.dateFrom} /><Field label="結束日" name="dateTo" type="date" defaultValue={dashboard.dateTo} /><fieldset><legend className="text-sm font-medium">攤位範圍</legend><div className="mt-1 flex min-h-11 flex-wrap items-center gap-3 rounded-md border border-stone-300 px-3">{availableStalls.map((stall) => <label key={stall.id} className="inline-flex items-center gap-2 text-sm"><input type="checkbox" name="stallId" value={stall.id} defaultChecked={dashboard.stalls.some((selected) => selected.id === stall.id)} />{stall.name}</label>)}</div></fieldset><button className="min-h-11 self-end rounded-md bg-stone-950 px-5 text-sm font-semibold text-white">查詢</button></div>
    </form>

    <section aria-label="營運損益摘要" className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8">
      <Metric icon={CircleDollarSign} label="淨營收" value={money(dashboard.summary.netSales)} />
      <Metric icon={TrendingUp} label="毛利" value={money(dashboard.summary.grossProfit)} hint={percent(dashboard.summary.grossMarginBasisPoints)} />
      <Metric icon={PackageSearch} label="食材／包材成本" value={money(dashboard.summary.theoreticalCogs)} />
      <Metric icon={UsersRound} label="已結案薪資" value={money(dashboard.summary.payrollCost)} hint={percent(dashboard.summary.laborCostBasisPoints)} />
      <Metric icon={ReceiptText} label="其他營業支出" value={money(dashboard.summary.operatingExpenseAmount)} />
      <Metric icon={dashboard.summary.operatingProfit >= 0 ? TrendingUp : TrendingDown} label="營業利益" value={money(dashboard.summary.operatingProfit)} hint={percent(dashboard.summary.operatingProfitBasisPoints)} negative={dashboard.summary.operatingProfit < 0} />
      <Metric icon={WalletCards} label="本期現金淨流量" value={money(dashboard.summary.netCashMovement)} negative={dashboard.summary.netCashMovement < 0} />
      <Metric icon={Boxes} label="期末庫存估值" value={money(dashboard.summary.inventoryValue)} />
    </section>

    {qualityAlerts.length ? <section className="rounded-xl border border-amber-300 bg-amber-50 p-4"><h2 className="flex items-center gap-2 font-semibold text-amber-950"><TriangleAlert className="h-5 w-5" />報表可信度待處理</h2><ul className="mt-2 grid gap-2 text-sm text-amber-950 sm:grid-cols-2">{qualityAlerts.map((alert) => <li key={alert} className="rounded-md bg-white/70 p-2">{alert}</li>)}</ul></section> : null}
    {message ? <p role="status" className={`rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length || message.includes("無法") ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}

    <section className="grid gap-4 lg:grid-cols-2">
      <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">月度實際營運損益</h2><dl className="mt-3 divide-y divide-stone-200 text-sm"><PnlRow label="淨營收" value={dashboard.summary.netSales} /><PnlRow label="－ 配方理論銷貨成本" value={-dashboard.summary.theoreticalCogs} /><PnlRow label="＝ 毛利" value={dashboard.summary.grossProfit} strong /><PnlRow label="－ 已結案員工薪資" value={-dashboard.summary.payrollCost} /><PnlRow label="－ 租金、水電與其他支出" value={-dashboard.summary.operatingExpenseAmount} /><PnlRow label="＝ 營業利益" value={dashboard.summary.operatingProfit} strong /></dl><p className="mt-3 text-xs leading-5 text-stone-500">進貨現金支出不會再重複扣入損益；它反映在庫存資產，商品售出後才依配方成本進入銷貨成本。</p></article>
      <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">本期現金收支</h2><dl className="mt-3 divide-y divide-stone-200 text-sm"><PnlRow label="已收款" value={dashboard.summary.cashCollected} /><PnlRow label="－ 進貨付款／到貨金額" value={-dashboard.summary.purchaseSpend} /><PnlRow label="－ 已結案員工薪資" value={-dashboard.summary.payrollCost} /><PnlRow label="－ 其他營業支出" value={-dashboard.summary.operatingExpenseAmount} /><PnlRow label="＝ 現金淨流量" value={dashboard.summary.netCashMovement} strong /></dl><div className="mt-4 grid grid-cols-2 gap-2"><Mini label="主要成本率" value={percent(dashboard.summary.primeCostBasisPoints)} /><Mini label="報廢耗損" value={money(dashboard.summary.wasteCost)} /></div></article>
    </section>

    {canManageExpenses ? <details className="group rounded-xl border border-stone-200 bg-white shadow-sm"><summary className="flex min-h-14 cursor-pointer list-none items-center justify-between px-4 py-3 font-semibold"><span className="flex items-center gap-2"><Banknote className="h-5 w-5" />新增水電、租金或其他支出</span><span className="transition-transform group-open:rotate-180">⌄</span></summary><form onSubmit={createExpense} className="border-t border-stone-200 p-4"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SelectField label="歸屬攤位" name="stallId" required={false} options={[["", "組織共用"], ...dashboard.stalls.map((stall) => [stall.id, stall.name] as const)]} error={fieldErrors.stallId} /><Field label="支出日期" name="expenseDate" type="date" defaultValue={dashboard.dateTo} error={fieldErrors.expenseDate} /><SelectField label="分類" name="category" options={Object.entries(expenseLabels)} error={fieldErrors.category} /><Field label="金額" name="amount" type="number" min="1" step="1" error={fieldErrors.amount} /><Field label="收款方（選填）" name="vendorName" required={false} error={fieldErrors.vendorName} /><Field label="支出說明" name="description" placeholder="例：8 月電費" error={fieldErrors.description} /><label className="flex min-h-11 items-center gap-2 self-end rounded-md border border-stone-300 px-3 text-sm font-medium"><input type="checkbox" name="isRecurring" className="h-5 w-5" />固定週期支出</label></div><button disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}新增支出</button></form></details> : null}

    <section className="grid gap-4 lg:grid-cols-2"><article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">支出分類</h2><div className="mt-3 space-y-2">{dashboard.expenseCategories.map((row) => <div key={row.category} className="flex justify-between rounded-lg border border-stone-200 p-3 text-sm"><span>{expenseLabels[row.category] ?? row.category}</span><strong>{money(row.amount)}</strong></div>)}{!dashboard.expenseCategories.length ? <p className="text-sm text-stone-600">此區間尚無其他營業支出。</p> : null}</div></article><article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">每日淨營收</h2><div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">{dashboard.dailySales.map((row) => <div key={row.businessDate} className="rounded-lg border border-stone-200 p-3"><p className="text-xs text-stone-500">{row.businessDate}</p><strong className="mt-1 block">{money(row.netSales)}</strong></div>)}{!dashboard.dailySales.length ? <p className="text-sm text-stone-600">此區間尚無完成訂單。</p> : null}</div></article></section>

    <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">商品毛利排行</h2><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[640px] text-left text-sm"><thead><tr className="border-b border-stone-200 text-stone-600"><th className="p-2">商品</th><th className="p-2 text-right">銷量</th><th className="p-2 text-right">營收</th><th className="p-2 text-right">估計成本</th><th className="p-2 text-right">毛利</th><th className="p-2 text-right">毛利率</th></tr></thead><tbody>{dashboard.productMargins.map((row) => <tr key={`${row.productId}-${row.productName}`} className="border-b border-stone-100"><td className="p-2 font-medium">{row.productName}</td><td className="p-2 text-right">{row.quantity}</td><td className="p-2 text-right">{money(row.revenue)}</td><td className="p-2 text-right">{money(row.estimatedCost)}</td><td className="p-2 text-right">{money(row.grossProfit)}</td><td className="p-2 text-right font-semibold">{percent(row.grossMarginBasisPoints)}</td></tr>)}</tbody></table>{!dashboard.productMargins.length ? <p className="py-8 text-center text-sm text-stone-600">此區間尚無可計算商品。</p> : null}</div></section>
  </div>;
}

function Metric({ icon: Icon, label, value, hint, negative = false }: { icon: typeof CircleDollarSign; label: string; value: string; hint?: string; negative?: boolean }) { return <article className="min-w-0 rounded-xl border border-stone-200 bg-white p-3 shadow-sm"><div className="flex items-center gap-1.5 text-xs text-stone-600"><Icon className="h-4 w-4 text-teal-700" />{label}</div><p className={`mt-2 break-words text-lg font-semibold tabular-nums ${negative ? "text-red-700" : "text-stone-950"}`}>{value}</p>{hint ? <p className="mt-1 text-xs text-stone-500">{hint}</p> : null}</article>; }
function PnlRow({ label, value, strong = false }: { label: string; value: number; strong?: boolean }) { return <div className={`flex justify-between gap-3 py-3 ${strong ? "font-semibold" : ""}`}><dt>{label}</dt><dd className={value < 0 ? "text-red-700" : ""}>{money(value)}</dd></div>; }
function Mini({ label, value }: { label: string; value: string }) { return <div className="rounded-lg bg-stone-50 p-3"><p className="text-xs text-stone-500">{label}</p><strong className="mt-1 block">{value}</strong></div>; }
function Field({ label, name, error, required = true, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string }) { const errorId = `${name}-error`; return <label className="grid gap-1 text-sm font-medium">{label}<input type={type} name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...props} className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3" />{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>; }
function SelectField({ label, name, options, error, required = true }: { label: string; name: string; options: readonly (readonly [string, string])[]; error?: string; required?: boolean }) { const errorId = `${name}-error`; return <label className="grid gap-1 text-sm font-medium">{label}<select name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className="min-h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3">{options.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select>{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>; }
function money(value: number) { const sign = value < 0 ? "−" : ""; return `${sign}${new Intl.NumberFormat("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 }).format(Math.abs(value))}`; }
function percent(basisPoints: number) { return `${(basisPoints / 100).toFixed(1)}%`; }
