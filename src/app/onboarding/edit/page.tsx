import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { OnboardingShell } from "@/components/onboarding-shell";
import { getPagePrincipal } from "@/lib/auth";
import { hasActiveOAuthIdentity } from "@/server/auth/oauth/profile-identity";
import { createOperationsScope } from "@/server/operations-read-scope";
import {
  loadOnboardingData,
  serializeApplicationInitialValues,
} from "@/server/merchant-applications/onboarding-page-data";

export default async function EditMerchantApplicationPage() {
  const principal = await getPagePrincipal();
  const hasOAuthIdentity = principal
    ? await hasActiveOAuthIdentity(principal.user.id)
    : false;
  if (!principal || (!principal.user.authUserId && !hasOAuthIdentity)) {
    redirect("/login?next=%2Fonboarding%2Fedit");
  }
  const data = await loadOnboardingData(principal.user.id, principal.user.email);
  if (data.workspacePath) redirect(data.workspacePath);
  if (data.application?.status !== "NEEDS_INFO") redirect(data.application ? "/onboarding/status" : "/onboarding");
  const scope = createOperationsScope(principal);
  return <OnboardingShell><OnboardingForm scopeKey={`onboarding-edit:${scope.principalKey}:${scope.sessionEpoch}`} authenticatedProfile={data.profile} initialValues={serializeApplicationInitialValues(data.application)} trial={data.trial} businessTypeOptions={data.businessTypeOptions} needsInfoNote={data.application.publicReviewNote} /></OnboardingShell>;
}
