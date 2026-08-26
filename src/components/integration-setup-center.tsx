import Link from "next/link";
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  LockKeyhole,
  ShieldCheck,
  Wrench,
} from "lucide-react";
import type { getIntegrationSetupCenterData } from "@/server/integrations/setup-center";

type SetupItem = Awaited<ReturnType<typeof getIntegrationSetupCenterData>>[number];

const statusPresentation = {
  NOT_CONFIGURED: { label: "尚未設定", className: "bg-stone-100 text-stone-700", icon: CircleDashed },
  CONFIGURED: { label: "已設定", className: "bg-sky-50 text-sky-800", icon: Wrench },
  VALIDATING: { label: "驗證中", className: "bg-amber-50 text-amber-800", icon: CircleDashed },
  SANDBOX_READY: { label: "測試環境就緒", className: "bg-violet-50 text-violet-800", icon: CheckCircle2 },
  PILOT_READY: { label: "試營運就緒", className: "bg-cyan-50 text-cyan-800", icon: CheckCircle2 },
  PRODUCTION_READY: { label: "正式環境就緒", className: "bg-emerald-50 text-emerald-800", icon: ShieldCheck },
  DEGRADED: { label: "降級運作", className: "bg-orange-50 text-orange-800", icon: AlertTriangle },
  DISABLED: { label: "已停用", className: "bg-stone-100 text-stone-600", icon: LockKeyhole },
  ERROR: { label: "需要處理", className: "bg-red-50 text-red-800", icon: AlertTriangle },
} as const;

const architectureLabels = {
  READY: "架構已完成",
  FOUNDATION: "安全基礎已完成",
  PLANNED: "尚未開放設定",
} as const;

const categoryLabels = {
  IDENTITY: "身分驗證",
  MESSAGING: "顧客溝通",
  PAYMENT: "付款與發票",
  COMMERCE: "外送與商務",
  OPERATIONS: "營運工具",
  DEVELOPER: "開發者整合",
} as const;

function setupHref(item: SetupItem, organizationId: string) {
  if (!item.setupPath) return null;
  if (item.setupPath === "/merchant/account/security") return item.setupPath;
  const separator = item.setupPath.includes("?") ? "&" : "?";
  return `${item.setupPath}${separator}organizationId=${encodeURIComponent(organizationId)}`;
}

export function IntegrationSetupCenter({
  organizationId,
  items,
}: {
  organizationId: string;
  items: readonly SetupItem[];
}) {
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-teal-200 bg-teal-50 p-4 text-sm leading-6 text-teal-950">
        <div className="flex items-start gap-3">
          <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-semibold">連線狀態採保守判定</h2>
            <p className="mt-1 text-teal-900">
              「架構已完成」不代表已通過 Sandbox、Pilot 或 Production 驗證；沒有真實憑證與驗證紀錄時，一律顯示尚未設定。
            </p>
          </div>
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => {
          const presentation = statusPresentation[item.status];
          const StatusIcon = presentation.icon;
          const href = setupHref(item, organizationId);
          return (
            <article key={item.code} className="flex min-h-64 flex-col rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-semibold tracking-wide text-teal-700">{categoryLabels[item.category]}</p>
                  <h2 className="mt-1 text-lg font-semibold text-stone-950">{item.label}</h2>
                </div>
                <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${presentation.className}`}>
                  <StatusIcon className="h-3.5 w-3.5" />
                  {presentation.label}
                </span>
              </div>

              <p className="mt-3 text-sm leading-6 text-stone-600">{item.description}</p>
              <div className="mt-3 flex flex-wrap gap-1.5">
                {item.capabilities.map((capability) => (
                  <span key={capability} className="rounded-full bg-stone-100 px-2 py-1 text-xs text-stone-700">
                    {capability}
                  </span>
                ))}
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-stone-100 pt-3 text-xs">
                <div>
                  <dt className="text-stone-500">技術狀態</dt>
                  <dd className="mt-1 font-medium text-stone-800">{architectureLabels[item.architecture]}</dd>
                </div>
                <div>
                  <dt className="text-stone-500">連線數</dt>
                  <dd className="mt-1 font-medium text-stone-800">{item.connectionCount}</dd>
                </div>
                {item.lastSuccessfulAt ? (
                  <div className="col-span-2">
                    <dt className="text-stone-500">最近成功</dt>
                    <dd className="mt-1 font-medium text-stone-800">
                      <time dateTime={item.lastSuccessfulAt}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(item.lastSuccessfulAt))}</time>
                    </dd>
                  </div>
                ) : null}
                {item.lastErrorCode ? (
                  <div className="col-span-2">
                    <dt className="text-stone-500">最近錯誤代碼</dt>
                    <dd className="mt-1 break-all font-mono text-red-700">{item.lastErrorCode}</dd>
                  </div>
                ) : null}
              </dl>

              <div className="mt-auto pt-4">
                {href ? (
                  <Link href={href} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold text-stone-900 hover:border-teal-600 hover:bg-teal-50">
                    前往設定
                    <ExternalLink className="h-4 w-4" />
                  </Link>
                ) : (
                  <div className="flex min-h-11 items-center justify-center rounded-md bg-stone-100 px-3 text-center text-sm font-medium text-stone-500">
                    {item.manualApprovalRequired ? "等待供應商／平台核准" : "等待後續模組開放"}
                  </div>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
