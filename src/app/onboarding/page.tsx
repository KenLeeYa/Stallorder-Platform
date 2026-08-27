import Link from "next/link";
import { redirect } from "next/navigation";
import { LazyOnboardingForm } from "@/components/lazy-onboarding-form";
import { OnboardingShell } from "@/components/onboarding-shell";
import type { AppLocale } from "@/lib/app-locale";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { getPagePrincipal } from "@/lib/auth";
import { onboardingStatusMessages } from "@/lib/messages/onboarding-status";
import { hasActiveOAuthIdentity } from "@/server/auth/oauth/profile-identity";
import {
  loadOnboardingData,
  serializeApplicationInitialValues,
} from "@/server/merchant-applications/onboarding-page-data";
import { canStartMerchantReapplication } from "@/server/merchant-applications/application-state";

export default async function OnboardingPage() {
  const [principal, { locale }] = await Promise.all([getPagePrincipal(), getRequestAppLocale()]);
  const hasOAuthIdentity = principal
    ? await hasActiveOAuthIdentity(principal.user.id)
    : false;
  if (!principal || (!principal.user.authUserId && !hasOAuthIdentity)) {
    redirect("/login?next=%2Fonboarding");
  }
  const data = await loadOnboardingData(principal.user.id, principal.user.email);
  if (data.workspacePath) redirect(data.workspacePath);
  if (data.application?.status === "NEEDS_INFO") redirect("/onboarding/edit");
  const isReapplication = data.application
    ? canStartMerchantReapplication(data.application.status, data.application.reapplicationAllowed)
    : false;
  if (data.application && !isReapplication && data.application.status !== "DRAFT") {
    redirect("/onboarding/status");
  }
  const initialValues = serializeApplicationInitialValues(data.application);
  if (isReapplication && initialValues) initialValues.currentStep = 1;
  return <OnboardingShell>
    {data.pendingInvitation ? <InvitationPriority locale={locale} /> : <LazyOnboardingForm authenticatedProfile={data.profile} initialValues={initialValues} trial={data.trial} businessTypeOptions={data.businessTypeOptions} isReapplication={isReapplication} />}
  </OnboardingShell>;
}

function InvitationPriority({ locale }: { locale: AppLocale }) {
  return <section className="mx-auto max-w-3xl border-y border-stone-200 bg-white py-8 sm:border sm:p-8"><h1 className="text-2xl font-semibold">{onboardingStatusMessages.get(locale, "invitationTitle")}</h1><p className="mt-3 text-stone-600">{onboardingStatusMessages.get(locale, "invitationDescription")}</p><Link href="/login" className="mt-6 inline-flex min-h-11 items-center bg-teal-700 px-5 text-sm font-semibold text-white">{onboardingStatusMessages.get(locale, "backToLogin")}</Link></section>;
}
