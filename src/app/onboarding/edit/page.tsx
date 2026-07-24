import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { OnboardingShell } from "@/components/onboarding-shell";
import { getPagePrincipal } from "@/lib/auth";
import {
  loadOnboardingData,
  serializeApplicationInitialValues,
} from "@/server/merchant-applications/onboarding-page-data";

export default async function EditMerchantApplicationPage() {
  const principal = await getPagePrincipal();
  if (!principal?.user.authUserId) redirect("/auth/google?next=%2Fonboarding%2Fedit");
  const data = await loadOnboardingData(principal.user.id, principal.user.email);
  if (data.workspacePath) redirect(data.workspacePath);
  if (data.application?.status !== "NEEDS_INFO") redirect(data.application ? "/onboarding/status" : "/onboarding");
  return <OnboardingShell><OnboardingForm authenticatedProfile={data.profile} initialValues={serializeApplicationInitialValues(data.application)} trial={data.trial} businessTypeOptions={data.businessTypeOptions} needsInfoNote={data.application.publicReviewNote} /></OnboardingShell>;
}
