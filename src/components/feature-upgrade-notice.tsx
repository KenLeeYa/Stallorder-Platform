import Link from "next/link";
import { LockKeyhole } from "lucide-react";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";

export function FeatureUpgradeNotice({
  title = "目前方案未包含此功能",
  message = "請由組織擁有者至訂閱與帳務頁面確認可用方案。",
  billingHref,
  returnStallId,
}: {
  title?: string;
  message?: string;
  billingHref?: string;
  returnStallId?: string;
}) {
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
            {billingHref ? (
              <Link
                href={billingHref}
                className="mt-4 inline-flex min-h-10 items-center rounded-md bg-stone-900 px-4 text-sm font-semibold text-white"
              >
                查看訂閱與帳務
              </Link>
            ) : null}
          </div>
        </div>
      </section>
    </main>
  );
}
