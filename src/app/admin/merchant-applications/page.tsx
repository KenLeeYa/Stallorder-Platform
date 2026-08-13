import Link from "next/link";
import type { MerchantApplicationRiskLevel, MerchantApplicationStatus } from "@prisma/client";
import {
  merchantApplicationStatusLabels,
  merchantBusinessTypeLabels,
} from "@/lib/merchant-application-contract";
import {
  listMerchantApplications,
  type MerchantApplicationListFilter,
} from "@/server/merchant-applications/merchant-application-admin-service";

const statuses = Object.keys(merchantApplicationStatusLabels) as MerchantApplicationStatus[];
const riskLevels: MerchantApplicationRiskLevel[] = ["LOW", "MEDIUM", "HIGH", "BLOCKED"];

export default async function MerchantApplicationsAdminPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const filters = parseFilters(query);
  const applications = await listMerchantApplications(filters);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header>
        <h1 className="text-3xl font-semibold">商家申請審核</h1>
        <p className="mt-2 text-sm text-stone-600">所有申請皆需人工核准；送出申請不會建立商家，核准後 QR 仍維持暫停。</p>
      </header>
      <form className="mt-6 grid gap-3 border-y border-stone-200 py-4 sm:grid-cols-2 lg:grid-cols-6">
        <FilterSelect name="status" label="狀態" value={value(query.status)}>
          {statuses.map((status) => <option key={status} value={status}>{merchantApplicationStatusLabels[status]}</option>)}
        </FilterSelect>
        <FilterSelect name="riskLevel" label="風險" value={value(query.riskLevel)}>
          {riskLevels.map((risk) => <option key={risk} value={risk}>{riskLabel(risk)}</option>)}
        </FilterSelect>
        <FilterSelect name="duplicateReason" label="重複訊號" value={value(query.duplicateReason)}>
          <option value="DUPLICATE_EMAIL">電子郵件</option><option value="DUPLICATE_PHONE">電話</option><option value="DUPLICATE_SLUG">網址／攤位代碼</option>
        </FilterSelect>
        <FilterSelect name="reviewer" label="審核人" value={value(query.reviewer)}>
          <option value="UNASSIGNED">未指派</option><option value="ASSIGNED">已指派</option>
        </FilterSelect>
        <FilterSelect name="submitted" label="送出時間" value={value(query.submitted)}>
          <option value="TODAY">今天</option><option value="OLDER_THAN_2_DAYS">超過 2 天</option>
        </FilterSelect>
        <div className="flex items-end gap-2"><button type="submit" className="min-h-11 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white">套用</button><Link href="/admin/merchant-applications" className="inline-flex min-h-11 items-center rounded-md px-3 text-sm font-semibold text-stone-700">清除</Link></div>
      </form>
      <div data-testid="merchant-applications-mobile-list" className="mt-5 grid gap-3 md:hidden">
        {applications.map((application) => (
          <article key={application.id} className="rounded-md border border-stone-200 bg-white p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-teal-800">{application.applicationNumber}</p>
                <h2 className="mt-1 break-words text-lg font-semibold">{application.merchantName ?? "未填寫"}</h2>
                <p className="mt-1 break-all text-sm text-stone-500">{application.applicantDisplayName} · {application.applicantEmail}</p>
              </div>
              <span className={`shrink-0 rounded-md px-2 py-1 text-xs font-semibold ${application.riskLevel === "HIGH" || application.riskLevel === "BLOCKED" ? "bg-red-50 text-red-800" : application.riskLevel === "MEDIUM" ? "bg-amber-50 text-amber-800" : "bg-emerald-50 text-emerald-800"}`}>風險 {riskLabel(application.riskLevel)}</span>
            </div>
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
              <MobileDetail label="狀態" value={merchantApplicationStatusLabels[application.status]} />
              <MobileDetail label="送出日期" value={formatDate(application.submittedAt)} />
              <MobileDetail label="營業類型" value={application.businessType ? merchantBusinessTypeLabels[application.businessType] : "-"} />
              <MobileDetail label="預估日訂單" value={String(application.estimatedDailyOrders ?? "-")} />
              <MobileDetail label="方案" value={application.requestedPlanCode} />
              <MobileDetail label="審核人" value={application.assignedReviewer?.displayName ?? "未指派"} />
            </dl>
            <Link href={`/admin/merchant-applications/${application.id}`} className="mt-4 inline-flex min-h-11 w-full items-center justify-center rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-800">{applicationActionLabel(application.status)}</Link>
          </article>
        ))}
      </div>
      <div data-testid="merchant-applications-desktop-table" className="mt-5 hidden overflow-x-auto border-y border-stone-200 md:block">
        <table className="w-full min-w-[1320px] text-left text-sm">
          <thead className="bg-stone-50 text-stone-600"><tr><th className="px-3 py-3">申請編號</th><th className="px-3 py-3">商家</th><th className="px-3 py-3">申請者</th><th className="px-3 py-3">電話</th><th className="px-3 py-3">類型</th><th className="px-3 py-3">方案</th><th className="px-3 py-3 text-right">日訂單</th><th className="px-3 py-3">狀態</th><th className="px-3 py-3">風險</th><th className="px-3 py-3">送出日期</th><th className="px-3 py-3">審核人</th><th className="px-3 py-3 text-right">操作</th></tr></thead>
          <tbody className="divide-y divide-stone-200">{applications.map((application) => <tr key={application.id}><td className="px-3 py-4 font-semibold">{application.applicationNumber}</td><td className="px-3 py-4">{application.merchantName ?? "未填寫"}</td><td className="px-3 py-4"><span className="block">{application.applicantDisplayName}</span><span className="text-xs text-stone-500">{application.applicantEmail}</span></td><td className="px-3 py-4">{application.phone ?? "-"}</td><td className="px-3 py-4">{application.businessType ? merchantBusinessTypeLabels[application.businessType] : "-"}</td><td className="px-3 py-4">{application.requestedPlanCode}</td><td className="px-3 py-4 text-right">{application.estimatedDailyOrders ?? "-"}</td><td className="px-3 py-4">{merchantApplicationStatusLabels[application.status]}</td><td className="px-3 py-4 font-semibold">{riskLabel(application.riskLevel)}</td><td className="px-3 py-4">{formatDate(application.submittedAt)}</td><td className="px-3 py-4">{application.assignedReviewer?.displayName ?? "未指派"}</td><td className="px-3 py-4 text-right"><Link href={`/admin/merchant-applications/${application.id}`} className="font-semibold text-teal-800">{applicationActionLabel(application.status)}</Link></td></tr>)}</tbody>
        </table>
      </div>
      {applications.length === 0 ? <p className="mt-5 border-y border-stone-200 px-3 py-8 text-sm text-stone-500">目前沒有符合條件的申請。</p> : null}
    </main>
  );
}

function FilterSelect({ name, label, value: selected, children }: { name: string; label: string; value: string; children: React.ReactNode }) {
  return <label className="text-sm font-medium"><span className="mb-1 block">{label}</span><select name={name} defaultValue={selected} className="min-h-11 w-full border border-stone-300 bg-white px-3"><option value="">全部</option>{children}</select></label>;
}

function MobileDetail({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 break-words">{value}</dd></div>;
}

function parseFilters(query: Record<string, string | string[] | undefined>): MerchantApplicationListFilter {
  const status = value(query.status);
  const riskLevel = value(query.riskLevel);
  const duplicateReason = value(query.duplicateReason);
  const reviewer = value(query.reviewer);
  const submitted = value(query.submitted);
  return {
    status: statuses.includes(status as MerchantApplicationStatus) ? status as MerchantApplicationStatus : undefined,
    riskLevel: riskLevels.includes(riskLevel as MerchantApplicationRiskLevel) ? riskLevel as MerchantApplicationRiskLevel : undefined,
    duplicateReason: ["DUPLICATE_EMAIL", "DUPLICATE_PHONE", "DUPLICATE_SLUG"].includes(duplicateReason) ? duplicateReason as MerchantApplicationListFilter["duplicateReason"] : undefined,
    reviewer: ["ASSIGNED", "UNASSIGNED"].includes(reviewer) ? reviewer as MerchantApplicationListFilter["reviewer"] : undefined,
    submitted: ["TODAY", "OLDER_THAN_2_DAYS"].includes(submitted) ? submitted as MerchantApplicationListFilter["submitted"] : undefined,
  };
}

function value(input: string | string[] | undefined) { return typeof input === "string" ? input : ""; }
function formatDate(input: Date | null) { return input?.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) ?? "-"; }
function riskLabel(risk: MerchantApplicationRiskLevel) { return { LOW: "低", MEDIUM: "中", HIGH: "高", BLOCKED: "已封鎖" }[risk]; }
function applicationActionLabel(status: MerchantApplicationStatus) {
  if (status === "PENDING_REVIEW") return "審核";
  if (status === "SUBMITTED" || status === "NEEDS_INFO") return "追蹤";
  return "查看紀錄";
}
