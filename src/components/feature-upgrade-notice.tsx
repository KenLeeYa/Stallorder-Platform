import Link from "next/link";
import { ArrowLeft, LockKeyhole } from "lucide-react";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { getBillingExperienceState } from "@/server/billing/billing-feature-flags";

export async function FeatureUpgradeNotice({
  title = "此功能尚未開放",
  message = "請由組織擁有者至訂閱與帳務頁面確認可用方案。",
  billingHref,
  returnHref,
  returnLabel = "返回上一頁",
  billingLabel = "查看訂閱與帳務",
  returnStallId,
}: {
  title?: string;
  message?: string;
  billingHref?: string;
  returnHref?: string;
  returnLabel?: string;
  billingLabel?: string;
  returnStallId?: string;
}) {
  const { merchantBillingVisible } = await getBillingExperienceState();
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      {returnStallId ? (
        <div className="mb-4">
          <StallSettingsBackLink stallId={returnStallId} />
        </div>
      ) : null}
      <section className="border-y border-amber-300 bg-amber-50 py-6" role="status">
        <div className="flex items-start gap-3 px-4">
          <LockKeyhole className="mt-0.5 h-5 w-5 shrink-0 text-amber-800" />
          <div>
            <h1 className="text-xl font-semibold text-amber-950">{title}</h1>
            <p className="mt-2 text-sm text-amber-900">{message}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              {returnHref ? (
                <Link
                  href={returnHref}
                  className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-900"
                >
                  <ArrowLeft className="h-4 w-4" />{returnLabel}
                </Link>
              ) : null}
              {billingHref && merchantBillingVisible ? (
                <Link
                  href={billingHref}
                  className="inline-flex min-h-10 items-center rounded-md bg-stone-900 px-4 text-sm font-semibold text-white"
                >
                  {billingLabel}
                </Link>
              ) : null}
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
