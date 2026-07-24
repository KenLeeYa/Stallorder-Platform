import Link from "next/link";
import { redirect } from "next/navigation";
import { OnboardingForm } from "@/components/onboarding-form";
import { OnboardingShell } from "@/components/onboarding-shell";
import { getPagePrincipal } from "@/lib/auth";
import {
  loadOnboardingData,
  serializeApplicationInitialValues,
} from "@/server/merchant-applications/onboarding-page-data";
import { canStartMerchantReapplication } from "@/server/merchant-applications/application-state";

export default async function OnboardingPage() {
  const principal = await getPagePrincipal();
  if (!principal?.user.authUserId) redirect("/auth/google?next=%2Fonboarding");
  const data = await loadOnboardingData(principal.user.id, principal.user.email, principal.user.platformRole);
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
    {data.pendingInvitation ? <InvitationPriority /> : <OnboardingForm authenticatedProfile={data.profile} initialValues={initialValues} trial={data.trial} isReapplication={isReapplication} />}
  </OnboardingShell>;
}

function InvitationPriority() {
  return <section className="mx-auto max-w-3xl border-y border-stone-200 bg-white py-8 sm:border sm:p-8"><h1 className="text-2xl font-semibold">已有待接受的工作區邀請</h1><p className="mt-3 text-stone-600">請使用邀請訊息中的連結，並以受邀的同一個 Google 電子郵件登入。完成邀請前不會建立新的商家申請。</p><Link href="/login" className="mt-6 inline-flex min-h-11 items-center bg-teal-700 px-5 text-sm font-semibold text-white">返回登入</Link></section>;
}
