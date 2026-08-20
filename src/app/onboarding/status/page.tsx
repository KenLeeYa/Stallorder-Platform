import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, FileCheck2 } from "lucide-react";
import { MerchantApplicationWithdrawAction } from "@/components/merchant-application-status-actions";
import type { AppLocale } from "@/lib/app-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getPagePrincipal } from "@/lib/auth";
import { hasActiveOAuthIdentity } from "@/server/auth/oauth/profile-identity";
import { onboardingStatusMessages } from "@/lib/messages/onboarding-status";
import { canStartMerchantReapplication } from "@/server/merchant-applications/application-state";
import { getApplicantApplication } from "@/server/merchant-applications/merchant-application-service";

export default async function MerchantApplicationStatusPage() {
  const [principal, { locale }] = await Promise.all([getPagePrincipal(), getRequestAppLocale()]);
  const hasOAuthIdentity = principal
    ? await hasActiveOAuthIdentity(principal.user.id)
    : false;
  if (!principal || (!principal.user.authUserId && !hasOAuthIdentity)) {
    redirect("/login?next=%2Fonboarding%2Fstatus");
  }
  const application = await getApplicantApplication(principal.user.id);
  if (!application) redirect("/onboarding");
  if (application.status === "DRAFT") redirect("/onboarding");
  const next = statusNextStep(application.status, locale);
  const canReapply = canStartMerchantReapplication(application.status, application.reapplicationAllowed);
  const t = (key: Parameters<typeof onboardingStatusMessages.get>[1]) => onboardingStatusMessages.get(locale, key);
  return <main className="min-h-screen px-4 py-8"><section className="mx-auto max-w-3xl border-y border-stone-200 bg-white py-7 sm:border sm:p-7"><header className="flex items-start gap-3 border-b border-stone-200 pb-5"><FileCheck2 className="mt-1 h-6 w-6 text-teal-700" /><div><p className="text-sm font-semibold text-teal-800">{application.applicationNumber}</p><h1 className="mt-1 text-2xl font-semibold">{application.merchantName ?? t("applicationTitle")}</h1><p className="mt-2 text-sm text-stone-600">{statusLabel(application.status, locale)}</p></div></header><dl className="grid gap-4 py-6 sm:grid-cols-2"><Info label={t("submittedDate")} value={application.submittedAt?.toLocaleDateString(locale, { timeZone: "Asia/Taipei" }) ?? t("notSubmitted")} /><Info label={t("lastUpdated")} value={application.updatedAt.toLocaleString(locale, { timeZone: "Asia/Taipei" })} /><Info label={t("requestedStall")} value={application.stallName ?? t("notProvided")} /><Info label={t("publicIdentifier")} value={application.requestedSlug ?? t("notProvided")} /></dl>{application.publicReviewNote ? <section className="border-l-4 border-amber-500 bg-amber-50 px-4 py-3"><h2 className="font-semibold text-amber-950">{t("platformNote")}</h2><p className="mt-1 text-sm text-amber-900">{application.publicReviewNote}</p></section> : null}<section className="mt-6 flex items-start gap-3 border-y border-stone-200 py-4"><Clock3 className="mt-0.5 h-5 w-5 text-stone-500" /><div><h2 className="font-semibold">{t("nextStep")}</h2><p className="mt-1 text-sm text-stone-600">{next}</p></div></section><div className="mt-6 flex flex-wrap gap-3">{application.status === "NEEDS_INFO" ? <Link href="/onboarding/edit" className="inline-flex min-h-11 items-center bg-teal-700 px-5 text-sm font-semibold text-white">{t("addInformation")}</Link> : null}{application.status === "APPROVED" && application.approvedOrganizationId ? <Link href={`/merchant/setup?organizationId=${application.approvedOrganizationId}`} className="inline-flex min-h-11 items-center bg-teal-700 px-5 text-sm font-semibold text-white">{t("merchantSetup")}</Link> : null}{["PENDING_REVIEW", "NEEDS_INFO"].includes(application.status) ? <MerchantApplicationWithdrawAction applicationId={application.id} /> : null}{canReapply ? <Link href="/onboarding" className="inline-flex min-h-11 items-center bg-teal-700 px-5 text-sm font-semibold text-white">{t("reapply")}</Link> : null}</div></section></main>;
}

function Info({ label, value }: { label: string; value: string }) { return <div><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 text-sm text-stone-900">{value}</dd></div>; }

function statusNextStep(status: string, locale: AppLocale) {
  if (status === "PENDING_REVIEW" || status === "SUBMITTED") return onboardingStatusMessages.get(locale, "nextSubmitted");
  if (status === "NEEDS_INFO") return onboardingStatusMessages.get(locale, "nextNeedsInfo");
  if (status === "APPROVED") return onboardingStatusMessages.get(locale, "nextApproved");
  if (status === "REJECTED") return onboardingStatusMessages.get(locale, "nextRejected");
  if (status === "WITHDRAWN") return onboardingStatusMessages.get(locale, "nextWithdrawn");
  return onboardingStatusMessages.get(locale, "nextExpired");
}

function statusLabel(status: string, locale: AppLocale) {
  const keys = {
    DRAFT: "statusDraft", SUBMITTED: "statusSubmitted", PENDING_REVIEW: "statusPending", NEEDS_INFO: "statusNeedsInfo",
    APPROVED: "statusApproved", REJECTED: "statusRejected", WITHDRAWN: "statusWithdrawn", EXPIRED: "statusExpired",
  } as const;
  return onboardingStatusMessages.get(locale, keys[status as keyof typeof keys] ?? "statusExpired");
}
