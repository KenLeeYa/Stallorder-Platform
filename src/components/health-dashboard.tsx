import { Activity, ArrowRight, CheckCircle2, CircleHelp, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { DrOperatorReadiness } from "@/server/resilience/dr-operator-readiness";
import type { DependencyHealth, HealthStatus } from "@/server/resilience/health-service";

type Snapshot = { status: HealthStatus; checkedAt: string; dependencies: DependencyHealth[] };
type Props = { kind: "primary"; snapshot: Snapshot | null } | { kind: "dr"; readiness: DrOperatorReadiness | null };
type Check = { name: string; detail: string; status: "pass" | "warn" | "fail" | "unknown" | "paused"; value?: string };

const dependencies: Record<string, [string, string]> = {
  application: ["網站服務", "確認本次網站請求可以執行。"],
  primaryDatabase: ["目前資料庫", "確認目前網站使用的資料庫可以連線。"],
  drDatabase: ["備援資料庫", "確認備援資料庫的連線狀態。"],
  replication: ["資料同步", "確認最近同步觀測、延遲與資料結構相容性。"],
  primaryEdge: ["主站點餐服務", "顧客建立與查詢訂單的後端服務。"],
  drEdge: ["備援點餐服務", "故障切換時使用的點餐後端服務。"],
  realtime: ["即時資料更新", "訂單變動的即時通知通道。"],
  sse: ["訂單狀態串流", "店員與廚房看板的持續更新通道。"],
  storageMirror: ["圖片與檔案備份", "商品圖片等檔案的備援同步。"],
  turnstile: ["點餐安全驗證", "Cloudflare 管理的顧客安全驗證服務。"],
  linePay: ["LINE Pay 付款", "目前設定的 LINE Pay 可用狀態。"],
  jkoPay: ["街口支付", "目前設定的街口支付可用狀態。"],
  reportDelivery: ["報表寄送", "排程報表的寄送服務。"],
};
const reasons: Record<string, string> = {
  NOT_CONFIGURED: "尚未設定連線。",
  DR_NOT_CONFIGURED: "尚未設定備援連線。",
  PROBE_TIMEOUT: "檢查逾時，請重試並檢查連線。",
  PROBE_FAILED: "無法完成連線檢查。",
  INVALID_CONFIGURATION: "連線設定無效，需由維運人員處理。",
  NO_OBSERVATION: "尚無同步觀測紀錄。",
  OBSERVATION_STALE: "同步觀測已過期，不能代表目前狀態。",
  OBSERVATION_UNAVAILABLE: "無法讀取同步觀測。",
  REPLICATION_NOT_READY: "同步延遲或資料結構尚未符合備援條件。",
  PROBE_NOT_IMPLEMENTED: "尚未接入自動檢查，需另行驗證。",
  EDGE_MANAGED: "由點餐服務管理，本看板尚未完成實際驗證。",
  SIMULATION_MODE: "目前為模擬模式，未實際寄送。",
  PROVIDER_UNKNOWN: "尚未取得供應商狀態。",
  PROVIDER_DEGRADED: "供應商服務效能降低。",
  PROVIDER_UNAVAILABLE: "供應商服務目前不可用。",
  PROVIDER_MAINTENANCE: "目前停用或維護中。",
};
const checkLabels = {
  drRuntimeBinding: ["備援環境一致", "網站、登入設定與資料庫均指向 DR 備援環境。"],
  supabaseProjectBinding: ["備援服務一致", "登入與點餐服務使用同一個備援專案。"],
  epochAligned: ["切換版本一致", "網站與資料庫的切換版本相同，避免新舊環境混用。"],
  readOnlyStandby: ["唯讀待命", "備援資料庫保持唯讀，不與正式站同時接單寫入。"],
  writerFence: ["寫入防護", "資料庫已啟用防護，阻擋不符合角色或切換版本的寫入。"],
} as const;

function dependencyCheck(item: DependencyHealth): Check {
  const [name, detail] = dependencies[item.key] ?? ["其他服務", "尚無項目說明。"];
  return {
    name,
    detail: item.reasonCode ? (reasons[item.reasonCode] ?? "狀態尚未確認，請由維運人員檢查。") : detail,
    status: item.status === "HEALTHY" ? "pass" : item.status === "UNAVAILABLE" ? "fail"
      : item.status === "UNKNOWN" ? "unknown" : item.status === "MAINTENANCE" ? "paused" : "warn",
    value: item.latencyMs === null ? undefined : item.key === "replication"
      ? `同步延遲 ${(item.latencyMs / 1000).toFixed(1)} 秒` : `回應 ${Math.round(item.latencyMs)} 毫秒`,
  };
}

export function HealthDashboard(props: Props) {
  const dr = props.kind === "dr";
  const data = dr ? props.readiness : props.snapshot;
  const checks: Check[] = dr
    ? Object.entries(checkLabels).map(([key, [name, detail]]) => ({
      name, detail, status: props.readiness ? (props.readiness.checks[key as keyof typeof checkLabels] ? "pass" : "fail") : "unknown",
    }))
    : props.snapshot?.dependencies.map(dependencyCheck) ?? [];
  const counts = {
    pass: checks.filter((item) => item.status === "pass").length,
    attention: checks.filter((item) => item.status === "warn" || item.status === "fail").length,
    unknown: checks.filter((item) => item.status === "unknown").length,
    paused: checks.filter((item) => item.status === "paused").length,
  };
  const headline = !data ? "目前無法完成檢查" : counts.attention > 0 ? "有項目需要處理"
    : counts.unknown > 0 ? "已檢查項目正常，部分尚待驗證" : dr ? "備援環境已就緒" : "已檢查項目正常";
  const checkedAt = data ? new Intl.DateTimeFormat("zh-TW", {
    dateStyle: "medium", timeStyle: "medium", timeZone: "Asia/Taipei",
  }).format(new Date(data.checkedAt)) : "尚無有效結果";
  const tones = {
    pass: { label: "正常", icon: CheckCircle2, className: "bg-teal-50 text-teal-800 border-teal-200" },
    warn: { label: "需留意", icon: TriangleAlert, className: "bg-amber-50 text-amber-900 border-amber-200" },
    fail: { label: "異常", icon: TriangleAlert, className: "bg-red-50 text-red-800 border-red-200" },
    unknown: { label: "待驗證", icon: CircleHelp, className: "bg-stone-100 text-stone-700 border-stone-200" },
    paused: { label: "停用／維護", icon: CircleHelp, className: "bg-stone-100 text-stone-600 border-stone-200" },
  };

  return (
    <main lang="zh-Hant-TW" className="mx-auto max-w-6xl space-y-6 px-4 py-8 text-stone-950 md:px-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-teal-700"><ShieldCheck className="h-4 w-4" aria-hidden />僅限{dr ? "指定 Cloudflare 維運管理者" : "平台管理者"}</p>
          <h1 className="text-2xl font-bold sm:text-3xl">{dr ? "DR 備援健康看板" : "正式站健康看板"}</h1>
          <p className="mt-2 text-sm text-stone-600">最後檢查：{checkedAt}（台北時間）</p>
        </div>
        <a href={dr ? "/operator/health" : "/admin/health"} className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 bg-white px-4 font-semibold hover:bg-stone-100 focus-visible:outline-2 focus-visible:outline-teal-600">
          <RefreshCw className="h-4 w-4" aria-hidden />重新檢查
        </a>
      </header>
      <section aria-label="檢查摘要" className="rounded-2xl border border-stone-200 bg-white p-5 sm:p-6">
        <h2 className="flex items-start gap-3 text-xl font-semibold"><Activity aria-hidden className="mt-0.5 h-6 w-6 shrink-0 text-teal-700" />{headline}</h2>
        <p className="mt-3 leading-relaxed text-stone-600">{dr
          ? "此看板僅檢查備援待命條件；不會切換正式流量，也不會開啟備援寫入。"
          : "此看板呈現已接入的檢查結果；「待驗證」不代表正常，仍需進行對應功能實測。"}</p>
        {!data && <p role="alert" className="mt-3 text-red-700">檢查服務暫時無法取得結果。請重新檢查；持續失敗時請查看維運紀錄。</p>}
        <dl className="mt-5 grid grid-cols-3 gap-2 border-t border-stone-200 pt-4">
          {[["正常", counts.pass], ["需處理", counts.attention], ["待驗證", counts.unknown]].map(([label, count]) => (
            <div key={label} className="min-w-0"><dt className="text-sm text-stone-600">{label}</dt><dd className="mt-1 text-2xl font-bold">{count}</dd></div>
          ))}
        </dl>
        {counts.paused > 0 && <p className="mt-3 text-sm text-stone-600">另有 {counts.paused} 項停用或維護中。</p>}
      </section>
      <section aria-label="各項服務檢查" className="grid gap-4 md:grid-cols-2">
        {checks.map((item) => {
          const tone = tones[item.status];
          const Icon = tone.icon;
          return (
            <article key={item.name} className="min-w-0 rounded-xl border border-stone-200 bg-white p-5">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">{item.name}</h2>
                <span className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold ${tone.className}`}><Icon aria-hidden className="h-4 w-4" />{tone.label}</span>
              </div>
              <p className="mt-3 leading-relaxed text-stone-600">{item.detail}</p>
              {item.value && <p className="mt-3 text-sm font-medium text-stone-700">{item.value}</p>}
            </article>
          );
        })}
      </section>
      {dr && props.readiness && <details className="rounded-xl border border-stone-200 bg-white p-5">
        <summary className="min-h-11 cursor-pointer font-semibold">環境詳細資訊</summary>
        <dl className="grid gap-4 pt-3 text-sm sm:grid-cols-2">
          {[
            ["網站後端", props.readiness.runtime.backendTarget === "DR" ? "DR 備援環境" : "設定異常"],
            ["登入環境", props.readiness.runtime.authProjectCode === "DR" ? "DR 備援環境" : "設定異常"],
            ["資料庫環境", props.readiness.database.backendCode === "DR" ? "DR 備援環境" : "設定異常"],
            ["資料庫角色", props.readiness.database.backendRole === "READ_ONLY_STANDBY" ? "唯讀待命" : "非唯讀待命，需確認"],
            ["網站切換版本", props.readiness.runtime.promotionEpoch ?? "未設定"],
            ["資料庫切換版本", props.readiness.database.promotionEpoch ?? "未取得"],
            ["資料庫寫入", props.readiness.database.writesEnabled === false ? "已關閉" : props.readiness.database.writesEnabled === true ? "已開啟，需確認" : "未取得"],
            ["寫入防護", props.readiness.database.enforcementEnabled === true ? "已啟用" : "未啟用或未取得"],
            ["備援專案識別碼", props.readiness.runtime.supabaseProjectRef || "未設定"],
          ].map(([label, value]) => <div key={label} className="min-w-0"><dt className="text-stone-600">{label}</dt><dd className="mt-1 break-all font-medium">{value}</dd></div>)}
        </dl>
      </details>}
      <footer className="flex flex-wrap gap-3 text-sm text-stone-600">
        <a className="inline-flex min-h-11 items-center gap-2 rounded-lg px-2 text-teal-700 underline" href={dr ? "https://app.qidaigo.com/admin/health" : "https://dr.qidaigo.com/operator/health"}>
          前往{dr ? "正式站" : "DR 備援"}健康看板<ArrowRight aria-hidden className="h-4 w-4" />
        </a>
        <p className="self-center">唯讀檢視 · 不顯示密鑰或顧客資料</p>
      </footer>
    </main>
  );
}
