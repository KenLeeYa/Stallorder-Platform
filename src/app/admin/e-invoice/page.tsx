import { requirePlatformAdminPage } from "@/lib/authorization";
import { getAdminEInvoiceData } from "@/server/e-invoice/e-invoice-service";

export default async function AdminEInvoicePage() {
  await requirePlatformAdminPage("/admin/e-invoice");
  const data = await getAdminEInvoiceData();
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header><p className="text-sm font-semibold text-teal-800">平台整合 · 唯讀監控</p><h1 className="mt-1 text-3xl font-semibold">電子發票整合</h1><p className="mt-2 text-sm text-stone-600">不顯示店家明文憑證；目前完成度不得高於 LOCAL_MOCK_READY。</p></header>
      <section className="mt-6 rounded-xl border-2 border-amber-400 bg-amber-50 p-5 text-sm text-amber-950"><strong>{data.readiness}</strong><p className="mt-1">Production Issue：{data.productionIssueEnabled ? "ON" : "OFF"}。Mock、Sandbox、Pilot 與 Production 證據不得互相替代。</p></section>
      <section className="mt-6 grid gap-3 md:grid-cols-3">{data.providers.map((provider) => <article key={provider.provider} className="rounded-xl border border-stone-200 bg-white p-5"><strong>{provider.label}</strong><p className="mt-2 text-sm">{provider.contractStatus}</p><p className="mt-2 break-words text-xs text-red-700">{provider.liveBlocker}</p></article>)}</section>
      <section className="mt-7"><h2 className="text-xl font-semibold">連線狀態</h2><div className="mt-3 overflow-x-auto"><table className="min-w-full text-left text-sm"><thead><tr className="border-b border-stone-200"><th className="p-3">Provider</th><th className="p-3">環境</th><th className="p-3">狀態</th><th className="p-3 text-right">商家數</th></tr></thead><tbody>{data.connections.map((row) => <tr key={`${row.provider}:${row.environment}:${row.status}`} className="border-b border-stone-100"><td className="p-3">{row.provider}</td><td className="p-3">{row.environment}</td><td className="p-3">{row.status}</td><td className="p-3 text-right">{row.count}</td></tr>)}</tbody></table></div></section>
      <section className="mt-7 grid gap-5 lg:grid-cols-2"><Summary title="文件狀態" rows={data.documents.map((row) => [`${row.status}`, row.count])} /><Summary title="操作佇列" rows={data.operations.map((row) => [`${row.operationType} · ${row.status}`, row.count])} /></section>
      <section className="mt-6 rounded-xl border border-stone-200 bg-white p-5"><h2 className="font-semibold">待人工對帳</h2><p className="mt-2 text-3xl font-semibold tabular-nums">{data.openReconciliationCases}</p><p className="mt-2 text-sm text-stone-600">差異只建立案件，不會自動改寫發票、訂單或付款紀錄。</p></section>
      <section className="mt-6 rounded-xl border border-stone-200 bg-stone-50 p-5 text-sm"><strong>高權限操作暫停</strong><p className="mt-1 text-stone-600">停用正式連線、強制健康檢查、重試與人工結案需在 RBAC、理由與正式 Provider contract 驗證後才會開放。此頁目前不提供可繞過 Gate 的按鈕。</p></section>
    </main>
  );
}

function Summary({ title, rows }: { title: string; rows: Array<[string, number]> }) {
  return <section className="rounded-xl border border-stone-200 bg-white p-5"><h2 className="font-semibold">{title}</h2><div className="mt-3 divide-y divide-stone-100">{rows.map(([label, count]) => <div key={label} className="flex justify-between gap-3 py-2 text-sm"><span>{label}</span><strong>{count}</strong></div>)}{rows.length === 0 ? <p className="py-3 text-sm text-stone-500">尚無資料。</p> : null}</div></section>;
}
