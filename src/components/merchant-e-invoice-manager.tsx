"use client";

import { useMemo, useState, type ReactNode } from "react";
import { csrfHeaders } from "@/lib/csrf-client";

type Dashboard = {
  readiness: "ARCHITECTURE_READY" | "LOCAL_MOCK_READY";
  devMode: boolean;
  productionIssueEnabled: boolean;
  flags: Record<string, boolean>;
  seller: null | { legalName: string; maskedTaxId: string | null; verificationStatus: string; defaultTaxType: string; testOnly: boolean };
  connections: Array<{ id: string; provider: string; environment: string; status: string; maskedMerchantAccountId: string | null; secretReferencePresent: boolean; lastValidatedAt: string | null; lastSuccessfulRequestAt: string | null; lastErrorCode: string | null }>;
  policies: Array<{ id: string; version: number; trigger: string; defaultTaxType: string; effectiveFrom: string; effectiveUntil: string | null }>;
  providers: Array<{ provider: string; label: string; contractStatus: string; mockAvailable: boolean; officialDocumentation: string[]; liveBlocker: string; capabilities: Record<string, boolean> }>;
  eligibleOrders: Array<{ id: string; stallId: string; stallName: string; orderNo: string; total: number; completedAt: string | null }>;
  documents: Array<{ id: string; orderId: string; orderNo: string; provider: string; environment: string; documentType: string; status: string; buyerType: string; totalAmount: number; taxAmount: number; allowedAmount: number; currency: string; externalInvoiceNumber: string | null; issuedAt: string | null; paymentStatus: string; reconciliationStatus: string; testDocument: boolean; hasAllowanceReference?: boolean; operations: Array<{ operationType: string; status: string; attempt: number; errorCode: string | null; createdAt: string }>; reconciliationCases: Array<{ id: string; caseType: string; reviewStatus: string }> }>;
};

const buyerTypes = [
  ["CLOUD", "雲端發票"],
  ["MOBILE_BARCODE", "手機條碼載具"],
  ["MEMBER_CARRIER", "會員載具"],
  ["BUSINESS", "統編發票"],
  ["DONATION", "捐贈"],
  ["PAPER", "紙本證明聯"],
] as const;

export function MerchantEInvoiceManager({ organizationId, initialData }: { organizationId: string; initialData: Dashboard }) {
  const [data, setData] = useState(initialData);
  const [provider, setProvider] = useState("ECPAY");
  const [orderId, setOrderId] = useState(initialData.eligibleOrders[0]?.id ?? "");
  const [buyerType, setBuyerType] = useState<(typeof buyerTypes)[number][0]>("CLOUD");
  const [carrierValue, setCarrierValue] = useState("");
  const [buyerTaxId, setBuyerTaxId] = useState("");
  const [buyerName, setBuyerName] = useState("");
  const [donationCode, setDonationCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const selectedOrder = useMemo(() => data.eligibleOrders.find((order) => order.id === orderId), [data.eligibleOrders, orderId]);
  const remainingOrders = data.eligibleOrders.filter((order) => !data.documents.some((document) => document.orderId === order.id));

  async function execute(command: Record<string, unknown>) {
    setPending(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/e-invoice`, {
        method: "POST",
        headers: { ...csrfHeaders(), "x-idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(command),
      });
      const body = await response.json().catch(() => ({}));
      if (response.ok) {
        setData(body as Dashboard);
        const nextOrder = (body as Dashboard).eligibleOrders.find((order) => !(body as Dashboard).documents.some((document) => document.orderId === order.id));
        setOrderId(nextOrder?.id ?? "");
        setMessage("本機 Mock 操作已完成；這不是合法電子發票。 ");
      } else {
        setMessage(typeof body.error === "string" ? body.error : "目前無法完成本機 Mock 操作。 ");
      }
    } catch {
      setMessage("目前無法連線到本機 Mock 服務，請確認網路後再試。 ");
    } finally {
      setPending(false);
    }
  }

  function issue() {
    if (!orderId) return;
    const buyer = buyerType === "MOBILE_BARCODE" || buyerType === "MEMBER_CARRIER"
      ? { buyerType, carrierValue }
      : buyerType === "BUSINESS"
        ? { buyerType, buyerTaxId, buyerName }
        : buyerType === "DONATION"
          ? { buyerType, donationCode }
          : { buyerType };
    void execute({ operation: "ISSUE", orderId, buyer });
  }

  const steps = [
    ["賣方資料", Boolean(data.seller)],
    ["選擇供應商", data.connections.length > 0],
    ["供應商帳號參照", data.connections.some((item) => item.secretReferencePresent)],
    ["讀取能力", data.connections.length > 0],
    ["發票政策", data.policies.length > 0],
    ["結帳選項", false],
    ["Mock 連線測試", data.connections.some((item) => item.lastValidatedAt)],
    ["測試開立", data.documents.some((item) => item.status === "ISSUED")],
    ["測試查詢", data.documents.some((item) => item.operations.some((operation) => operation.operationType === "QUERY" && operation.status === "SUCCEEDED"))],
    ["測試作廢", data.documents.some((item) => item.status === "VOIDED")],
    ["測試折讓", data.documents.some((item) => item.allowedAmount > 0)],
    ["Production checklist", false],
    ["正式啟用", false],
  ] as const;

  return (
    <div className="space-y-7">
      <section className="rounded-xl border-2 border-amber-400 bg-amber-50 p-5 text-amber-950">
        <strong className="text-lg">TEST / NOT A LEGAL INVOICE</strong>
        <p className="mt-2 text-sm leading-6">目前完成度為 {data.readiness}。不使用真實統編或憑證、不呼叫正式供應商，也不會把 StallOrder 平台當成店家的賣方。</p>
        <p className="mt-1 text-sm">Production Issue：{data.productionIssueEnabled ? "已啟用" : "OFF（強制關閉）"}</p>
      </section>

      {message ? <p role="status" className="rounded-md border border-stone-300 bg-white p-3 text-sm">{message}</p> : null}

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div><h2 className="text-xl font-semibold">設定精靈</h2><p className="mt-1 text-sm text-stone-600">可儲存本機 Mock 進度；正式帳號、Sandbox 與 Production 必須日後另走核准流程。</p></div>
          <span className="rounded-full bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-900">{data.readiness}</span>
        </div>
        <ol className="mt-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {steps.map(([label, complete], index) => <li key={label} className="flex min-h-12 items-center gap-3 rounded-md border border-stone-200 px-3 text-sm"><span className={`grid h-7 w-7 place-items-center rounded-full text-xs font-bold ${complete ? "bg-emerald-700 text-white" : "bg-stone-100 text-stone-600"}`}>{complete ? "✓" : index + 1}</span><span>{label}</span></li>)}
        </ol>
        <div className="mt-5 flex flex-wrap items-end gap-3">
          <label className="min-w-56 text-sm font-medium">本機 Mock 供應商<select value={provider} onChange={(event) => setProvider(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3">{data.providers.filter((item) => item.mockAvailable).map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}</select></label>
          <button type="button" disabled={pending || !data.devMode} onClick={() => void execute({ operation: "BOOTSTRAP_MOCK", provider })} className="min-h-11 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50">建立／更新 Mock 設定</button>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        <StatusCard title="賣方資料" lines={data.seller ? [data.seller.legalName, `統編：${data.seller.maskedTaxId}`, `${data.seller.verificationStatus} · ${data.seller.defaultTaxType}`] : ["尚未設定"]} />
        <StatusCard title="供應商連線" lines={data.connections.length ? data.connections.map((item) => `${item.provider} · ${item.environment} · ${item.status} · ${item.maskedMerchantAccountId ?? "—"}`) : ["尚未設定"]} />
        <StatusCard title="不可變政策版本" lines={data.policies.length ? data.policies.map((item) => `v${item.version} · ${item.trigger} · ${item.defaultTaxType}`) : ["尚未設定"]} />
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">測試開立</h2>
        <p className="mt-1 text-sm text-stone-600">只列出已付款且已完成的訂單。金額與訂單關聯由伺服器讀取，瀏覽器不能自行指定。</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">訂單<select value={orderId} onChange={(event) => setOrderId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3"><option value="">請選擇</option>{remainingOrders.map((order) => <option key={order.id} value={order.id}>{order.stallName} · #{order.orderNo} · TWD {order.total}</option>)}</select></label>
          <label className="text-sm font-medium">發票選項<select value={buyerType} onChange={(event) => setBuyerType(event.target.value as typeof buyerType)} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3">{buyerTypes.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        </div>
        {(buyerType === "MOBILE_BARCODE" || buyerType === "MEMBER_CARRIER") ? <label className="mt-4 block text-sm font-medium">載具值<input type="text" value={carrierValue} onChange={(event) => setCarrierValue(event.target.value)} maxLength={64} className="form-input mt-1" autoComplete="off" /></label> : null}
        {buyerType === "BUSINESS" ? <div className="mt-4 grid gap-4 md:grid-cols-2"><label className="text-sm font-medium">統一編號<input type="text" value={buyerTaxId} onChange={(event) => setBuyerTaxId(event.target.value.replace(/\D/g, ""))} maxLength={8} inputMode="numeric" className="form-input mt-1" /></label><label className="text-sm font-medium">公司抬頭<input type="text" value={buyerName} onChange={(event) => setBuyerName(event.target.value)} maxLength={200} className="form-input mt-1" /></label></div> : null}
        {buyerType === "DONATION" ? <label className="mt-4 block text-sm font-medium">捐贈碼<input type="text" value={donationCode} onChange={(event) => setDonationCode(event.target.value.replace(/\D/g, ""))} maxLength={7} inputMode="numeric" className="form-input mt-1" /></label> : null}
        <button type="button" disabled={pending || !selectedOrder || data.connections.length === 0} onClick={issue} className="mt-5 min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">開立 TEST 文件</button>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">電子發票紀錄</h2>
        <div className="mt-4 divide-y divide-stone-200">
          {data.documents.map((document) => (
            <article key={document.id} className="py-4 text-sm">
              <div className="flex flex-wrap items-start justify-between gap-3"><div><strong>#{document.orderNo} · {document.status}</strong><p className="mt-1 text-stone-600">{document.provider} · {document.buyerType} · TWD {document.totalAmount} · 付款 {document.paymentStatus}</p><p className="mt-1 break-all text-xs text-amber-800">{document.externalInvoiceNumber ?? "尚無 TEST 文件編號"}</p></div><span className="rounded bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-900">{document.testDocument ? "TEST / 非合法發票" : "禁止顯示為正式"}</span></div>
              <div className="mt-3 flex flex-wrap gap-2"><Action disabled={pending || !document.externalInvoiceNumber} onClick={() => void execute({ operation: "QUERY", invoiceDocumentId: document.id })}>查詢</Action><Action disabled={pending || !["ISSUED", "FULLY_ALLOWED"].includes(document.status)} onClick={() => void execute({ operation: "VOID", invoiceDocumentId: document.id, reason: "本機 Mock 測試作廢" })}>作廢</Action><Action disabled={pending || !["ISSUED", "PARTIALLY_ALLOWED"].includes(document.status) || document.totalAmount <= document.allowedAmount} onClick={() => void execute({ operation: "ALLOWANCE", invoiceDocumentId: document.id, amount: document.totalAmount - document.allowedAmount, reason: "本機 Mock 測試折讓" })}>折讓剩餘金額</Action><Action disabled={pending || !document.hasAllowanceReference} onClick={() => void execute({ operation: "ALLOWANCE_VOID", invoiceDocumentId: document.id })}>作廢折讓</Action><Action disabled={pending || !document.externalInvoiceNumber} onClick={() => void execute({ operation: "RECONCILE", invoiceDocumentId: document.id })}>對帳</Action></div>
              {document.reconciliationCases.length ? <p className="mt-2 text-red-700">待人工處理：{document.reconciliationCases.map((item) => item.caseType).join("、")}</p> : null}
            </article>
          ))}
          {data.documents.length === 0 ? <p className="py-5 text-sm text-stone-500">尚無 TEST 文件。</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-stone-50 p-5">
        <h2 className="text-xl font-semibold">正式供應商狀態</h2>
        <div className="mt-4 grid gap-3 md:grid-cols-3">{data.providers.filter((item) => item.provider !== "CUSTOM").map((item) => <article key={item.provider} className="rounded-md border border-stone-200 bg-white p-4"><strong>{item.label}</strong><p className="mt-1 text-sm">{item.contractStatus}</p><p className="mt-2 break-words text-xs text-red-700">{item.liveBlocker}</p>{item.officialDocumentation.map((href) => <a key={href} className="mt-2 block break-all text-xs font-semibold text-teal-800 underline" href={href} target="_blank" rel="noreferrer">官方文件</a>)}</article>)}</div>
      </section>
    </div>
  );
}

function StatusCard({ title, lines }: { title: string; lines: string[] }) {
  return <section className="rounded-xl border border-stone-200 bg-white p-5"><h2 className="font-semibold">{title}</h2><div className="mt-3 space-y-1 text-sm text-stone-600">{lines.map((line) => <p key={line}>{line}</p>)}</div></section>;
}

function Action({ children, disabled, onClick }: { children: ReactNode; disabled: boolean; onClick: () => void }) {
  return <button type="button" disabled={disabled} onClick={onClick} className="min-h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40">{children}</button>;
}
