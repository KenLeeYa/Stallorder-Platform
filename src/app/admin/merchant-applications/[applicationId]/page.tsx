import Link from "next/link";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { notFound } from "next/navigation";
import { AdminMerchantApplicationActions } from "@/components/admin-merchant-application-actions";
import type { AppLocale } from "@/lib/app-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { formatAppDate, formatAppDateTime, formatAppNumber } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel, type AdminMessageKey } from "@/lib/messages/admin";
import { getMerchantApplicationForAdmin, listPlatformReviewers } from "@/server/merchant-applications/merchant-application-admin-service";

export default async function MerchantApplicationReviewPage({ params }: { params: Promise<{ applicationId: string }> }) {
  const [{ applicationId }, { locale }] = await Promise.all([params, getRequestAppLocale()]);
  const [application, reviewers] = await Promise.all([getMerchantApplicationForAdmin(applicationId), listPlatformReviewers()]);
  if (!application) notFound();
  const m = createAdminTranslator(locale);
  const riskReasons = Array.isArray(application.riskReasonsJson) ? application.riskReasonsJson.filter((value): value is string => typeof value === "string") : [];
  const loginIdentities = [...(application.applicant.authUserId ? [m("Existing Google")] : []), ...application.applicant.authIdentities.map((identity) => identity.provider)];
  const label = (key: AdminMessageKey) => m(key);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <ContextualBackButton fallbackHref="/admin/merchant-applications">{m("Back to applications")}</ContextualBackButton>
      <header className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{application.applicationNumber}</p><div className="mt-1 flex flex-wrap items-start justify-between gap-3"><div><h1 className="text-3xl font-semibold">{application.merchantName ?? m("Unnamed merchant")}</h1><p className="mt-2 text-sm text-stone-600">{getAdminCodeLabel(locale, application.status)} · {m("Risk: {risk}", { risk: getAdminCodeLabel(locale, application.riskLevel) })}</p></div><span className="text-sm font-semibold">{application.assignedReviewer?.displayName ?? m("No reviewer assigned")}</span></div></header>
      <div className="grid gap-8 py-6 lg:grid-cols-[1fr_360px]">
        <div className="space-y-7">
          <Section title={m("Applicant details")}><InfoGrid entries={[[label("Name"), application.applicantDisplayName], [label("Verified email"), application.applicantEmail], [label("Phone"), application.phone], ["LINE ID", application.lineId], [label("Contact preference"), application.preferredContactMethod ? getAdminCodeLabel(locale, application.preferredContactMethod) : null], [label("Sign-in identities"), loginIdentities.join(" · ") || m("None")]]} /></Section>
          <Section title={m("Merchant details")}><InfoGrid entries={[[label("Merchant name"), application.merchantName], [label("Business types"), application.businessType ? getAdminCodeLabel(locale, application.businessType) : null], [label("Business registration number"), application.businessRegistrationNumber], [label("Primary contact"), application.contactName], [label("Merchant phone"), application.businessPhone], [label("City / county"), application.city], [label("Address"), application.businessAddress], [label("Description"), application.merchantDescription]]} /></Section>
          <Section title={m("First stall")}><InfoGrid entries={[[label("Stall name"), application.stallName], [label("Operating location"), application.stallLocation], [label("Public identifier"), application.requestedSlug], [label("Estimated daily orders"), application.estimatedDailyOrders === null ? null : formatAppNumber(locale, application.estimatedDailyOrders)], [label("Expected start date"), application.expectedStartDate ? formatAppDate(locale, application.expectedStartDate) : null], [label("Plan"), application.requestedPlanCode], [label("Multiple staff"), m(application.needsMultipleStaff ? "Required" : "Not required")], [label("Kitchen display"), m(application.needsKitchenView ? "Required" : "Not required")]]} /></Section>
          <Section title={m("Review information")}><InfoGrid entries={[[label("Submitted time"), application.submittedAt ? formatAppDateTime(locale, application.submittedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }) : null], [label("Last reviewed"), application.reviewedAt ? formatAppDateTime(locale, application.reviewedAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }) : null], [label("Public note"), application.publicReviewNote], [label("Internal note"), application.internalReviewNote], [label("Risk signals"), riskReasons.map((reason) => getAdminCodeLabel(locale, reason)).join(" · ") || m("None")]]} /></Section>
          <Section title={m("Application history")}><ApplicationHistory applications={application.applicant.merchantApplications} currentApplicationId={application.id} locale={locale} /></Section>
          {application.approvedOrganization ? <Section title={m("Approval result")}><InfoGrid entries={[[label("Organization"), application.approvedOrganization.businessName], [label("Organization status"), getAdminCodeLabel(locale, application.approvedOrganization.status)], [label("Subscriptions"), application.approvedOrganization.subscription ? getAdminCodeLabel(locale, application.approvedOrganization.subscription.status) : null], [label("Plan version"), application.approvedOrganization.subscription ? `${application.approvedOrganization.subscription.planVersion.displayName} v${formatAppNumber(locale, application.approvedOrganization.subscription.planVersion.version)}` : null], [label("Test order"), m(application.approvedOrganization.merchantSetupProgress?.testOrderCompleted ? "Completed" : "Not completed")], [label("Production ordering"), m(application.approvedOrganization.merchantSetupProgress?.goLiveCompleted ? "Open" : "Not open")]]} /></Section> : null}
        </div>
        <aside><h2 className="mb-4 text-xl font-semibold">{m("Case actions")}</h2><AdminMerchantApplicationActions applicationId={application.id} status={application.status} reviewers={reviewers} /></aside>
      </div>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) { return <section className="border-t border-stone-200 pt-5"><h2 className="text-xl font-semibold">{title}</h2><div className="mt-4">{children}</div></section>; }
function InfoGrid({ entries }: { entries: Array<[string, string | null | undefined]> }) { return <dl className="grid gap-x-6 gap-y-4 sm:grid-cols-2">{entries.map(([label, value]) => <div key={label}><dt className="text-xs font-semibold text-stone-500">{label}</dt><dd className="mt-1 whitespace-pre-wrap text-sm">{value || "-"}</dd></div>)}</dl>; }
function ApplicationHistory({ applications, currentApplicationId, locale }: { applications: Array<{ id: string; applicationNumber: string; merchantName: string | null; status: string; createdAt: Date }>; currentApplicationId: string; locale: AppLocale }) { const m = createAdminTranslator(locale); return <ol className="divide-y divide-stone-200 border-y border-stone-200">{applications.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><div className="flex flex-wrap items-center gap-2"><Link href={`/admin/merchant-applications/${item.id}`} className="font-semibold text-teal-800">{item.applicationNumber}</Link>{item.id === currentApplicationId ? <span className="bg-stone-100 px-2 py-0.5 text-xs font-semibold text-stone-700">{m("Current case")}</span> : null}</div><p className="mt-1 text-xs text-stone-500">{item.merchantName ?? m("Unnamed merchant")} · {m("Created {date}", { date: formatAppDateTime(locale, item.createdAt, { dateStyle: "medium", timeStyle: "short", timeZone: "Asia/Taipei" }) })}</p></div><span className="text-sm font-semibold text-stone-700">{getAdminCodeLabel(locale, item.status)}</span></li>)}</ol>; }
