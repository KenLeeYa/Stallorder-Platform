import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, FileCheck2 } from "lucide-react";
import { MerchantApplicationWithdrawAction } from "@/components/merchant-application-status-actions";
import { getPagePrincipal } from "@/lib/auth";
import { merchantApplicationStatusLabels } from "@/lib/merchant-application-contract";
import { getApplicantApplication } from "@/server/merchant-applications/merchant-application-service";

export default async function MerchantApplicationStatusPage() {
  const principal = await getPagePrincipal();
  if (!principal?.user.authUserId) redirect("/login?next=%2Fonboarding%2Fstatus");
  const application = await getApplicantApplication(principal.user.id);
  if (!application) redirect("/onboarding");
  if (application.status === "DRAFT") redirect("/onboarding");
  const next = statusNextStep(application.status);
  return <main className="min-h-screen px-4 py-8"><section className="mx-auto max-w-3xl border-y border-stone-200 bg-white py-7 sm:border sm:p-7"><header className="flex items-start gap-3 border-b border-stone-200 pb-5"><FileCheck2 className="mt-1 h-6 w-6 text-teal-700" /><div><p className="text-sm font-semibold text-teal-800">{application.applicationNumber}</p><h1 className="mt-1 text-2xl font-semibold">{application.merchantName ?? "商家申請"}</h1><p className="mt-2 text-sm text-stone-600">{merchantApplicationStatusLabels[application.status]}</p></div></header><dl className="grid gap-4 py-6 sm:grid-cols-2"><Info label="送出日期" value={application.submittedAt?.toLocaleDateString("zh-TW", { timeZone: "Asia/Taipei" }) ?? "尚未送出"} /><Info label="最後更新" value={application.updatedAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })} /><Info label="申請攤位" value={application.stallName ?? "尚未填寫"} /><Info label="網址代稱" value={application.requestedSlug ?? "尚未填寫"} /></dl>{application.publicReviewNote ? <section className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3"><h2 className="font-semibold text-amber-950">平台說明</h2><p className="mt-1 text-sm text-amber-900">{application.publicReviewNote}</p></section> : null}<section className="mt-6 flex items-start gap-3 border-y border-stone-200 py-4"><Clock3 className="mt-0.5 h-5 w-5 text-stone-500" /><div><h2 className="font-semibold">下一步</h2><p className="mt-1 text-sm text-stone-600">{next}</p></div></section><div className="mt-6 flex flex-wrap gap-3">{application.status === "NEEDS_INFO" ? <Link href="/onboarding/edit" className="inline-flex min-h-11 items-center bg-teal-700 px-5 text-sm font-semibold text-white">補充申請資料</Link> : null}{application.status === "APPROVED" && application.approvedOrganizationId ? <Link href={`/merchant/setup?organizationId=${application.approvedOrganizationId}`} className="inline-flex min-h-11 items-center bg-teal-700 px-5 text-sm font-semibold text-white">前往商家設定</Link> : null}{["PENDING_REVIEW", "NEEDS_INFO"].includes(application.status) ? <MerchantApplicationWithdrawAction applicationId={application.id} /> : null}{application.status === "REJECTED" && application.reapplicationAllowed ? <Link href="/onboarding" className="inline-flex min-h-11 items-center border border-stone-300 px-5 text-sm font-semibold">重新申請</Link> : null}</div></section></main>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 text-sm text-stone-900">{value}</dd></div>; }

function statusNextStep(status: string) {
  if (status === "PENDING_REVIEW" || status === "SUBMITTED") return "申請已送出，平台將依資料完整性與風險狀態進行人工審核。";
  if (status === "NEEDS_INFO") return "請依平台說明補充資料並重新送出。";
  if (status === "APPROVED") return "申請已核准，請完成商家設定與測試訂單；完成前 QR 仍不會開放接單。";
  if (status === "REJECTED") return "本次申請未核准；如允許重新申請，頁面會顯示重新申請入口。";
  if (status === "WITHDRAWN") return "申請已撤回。";
  return "申請已逾期，請聯絡平台管理員確認後續處理方式。";
}
