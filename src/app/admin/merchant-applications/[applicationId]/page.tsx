import Link from "next/link";
import { notFound } from "next/navigation";
import { AdminMerchantApplicationActions } from "@/components/admin-merchant-application-actions";
import { merchantApplicationStatusLabels, merchantBusinessTypeLabels } from "@/lib/merchant-application-contract";
import { getMerchantApplicationForAdmin, listPlatformReviewers } from "@/server/merchant-applications/merchant-application-admin-service";

export default async function MerchantApplicationReviewPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const { applicationId } = await params;
  const [application, reviewers] = await Promise.all([getMerchantApplicationForAdmin(applicationId), listPlatformReviewers()]);
  if (!application) notFound();
  const riskReasons = Array.isArray(application.riskReasonsJson) ? application.riskReasonsJson.filter((value): value is string => typeof value === "string") : [];
  const loginIdentities = [
    ...(application.applicant.authUserId ? ["既有 Google"] : []),
    ...application.applicant.authIdentities.map((identity) => identity.provider),
  ];
  return <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8"><Link href="/admin/merchant-applications" className="text-sm font-semibold text-teal-800">返回申請列表</Link><header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{application.applicationNumber}</p><div className="mt-1 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-semibold">{application.merchantName ?? "未命名商家"}</h1><p className="mt-2 text-sm text-stone-600">{merchantApplicationStatusLabels[application.status]} · 風險 {application.riskLevel}</p></div><span className="text-sm font-semibold">{application.assignedReviewer?.displayName ?? "未指派審核人"}</span></div></header><div className="grid gap-8 py-6 lg:grid-cols-[1fr_360px]"><div className="space-y-7"><Section title="申請者"><InfoGrid entries={[["姓名", application.applicantDisplayName], ["已驗證信箱", application.applicantEmail], ["電話", application.phone], ["LINE ID", application.lineId], ["聯絡偏好", application.preferredContactMethod], ["登入身分", loginIdentities.join("、") || "無"]]} /></Section><Section title="商家資料"><InfoGrid entries={[["商家名稱", application.merchantName], ["營業類型", application.businessType ? merchantBusinessTypeLabels[application.businessType] : null], ["統一編號", application.businessRegistrationNumber], ["負責人", application.contactName], ["商家電話", application.businessPhone], ["縣市", application.city], ["地址", application.businessAddress], ["說明", application.merchantDescription]]} /></Section><Section title="第一個攤位"><InfoGrid entries={[["攤位名稱", application.stallName], ["營業地點", application.stallLocation], ["公開識別名稱", application.requestedSlug], ["預估每日訂單", application.estimatedDailyOrders?.toString()], ["預計開始日", application.expectedStartDate?.toISOString().slice(0, 10)], ["方案", application.requestedPlanCode], ["多員工", application.needsMultipleStaff ? "需要" : "不需要"], ["廚房畫面", application.needsKitchenView ? "需要" : "不需要"]]} /></Section><Section title="審核資訊"><InfoGrid entries={[["送出時間", application.submittedAt?.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })], ["最後審核", application.reviewedAt?.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })], ["公開說明", application.publicReviewNote], ["內部註記", application.internalReviewNote], ["風險訊號", riskReasons.join("、") || "無"]]} /></Section><Section title="申請歷程"><ApplicationHistory applications={application.applicant.merchantApplications} currentApplicationId={application.id} /></Section>{application.approvedOrganization ? <Section title="核准結果"><InfoGrid entries={[["組織", application.approvedOrganization.businessName], ["組織狀態", application.approvedOrganization.status], ["訂閱", application.approvedOrganization.subscription?.status], ["Plan Version", application.approvedOrganization.subscription ? `${application.approvedOrganization.subscription.planVersion.displayName} v${application.approvedOrganization.subscription.planVersion.version}` : null], ["測試訂單", application.approvedOrganization.merchantSetupProgress?.testOrderCompleted ? "已完成" : "未完成"], ["正式接單", application.approvedOrganization.merchantSetupProgress?.goLiveCompleted ? "已開放" : "尚未開放"]]} /></Section> : null}</div><aside><h2 className="mb-4 text-xl font-semibold">案件處理</h2><AdminMerchantApplicationActions applicationId={application.id} status={application.status} reviewers={reviewers} /></aside></div></main>;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="border-t border-stone-200 pt-5"><h2 className="text-xl font-semibold">{title}</h2><div className="mt-4">{children}</div></section>; }
function InfoGrid({ entries }: { entries: Array<[string, string | null | undefined]> }) { return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{entries.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{value || "-"}</dd></div>)}</dl>; }
function ApplicationHistory({
  applications,
  currentApplicationId,
}: {
  applications: Array<{
    id: string;
    applicationNumber: string;
    merchantName: string | null;
    status: keyof typeof merchantApplicationStatusLabels;
    createdAt: Date;
  }>;
  currentApplicationId: string;
}) {
  return <ol className="divide-y divide-stone-200 border-y border-stone-200">{applications.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="flex flex-wrap items-center gap-2"><Link href={`/admin/merchant-applications/${item.id}`} className="font-semibold text-teal-800">{item.applicationNumber}</Link>{item.id === currentApplicationId ? <span className="bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">目前案件</span> : null}</div><p className="mt-1 text-xs text-stone-500">{item.merchantName ?? "未命名商家"} · 建立於 {item.createdAt.toLocaleString("zh-TW", { timeZone: "Asia/Taipei" })}</p></div><span className="text-sm font-semibold text-stone-700">{merchantApplicationStatusLabels[item.status]}</span></li>)}</ol>;
}
