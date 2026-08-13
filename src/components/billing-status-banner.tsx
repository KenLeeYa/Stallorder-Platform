"use client";

import { formatAppDate } from "@/lib/locale-format";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

export function BillingStatusBanner({ status, trialEndsAt, paymentDueAt }: {
  status: string;
  trialEndsAt?: Date | null;
  paymentDueAt?: Date | null;
}) {
  const { locale, m } = useMerchantMessages();
  const labels: Record<string, string> = {
    TRIALING: m("試用中"),
    ACTIVE: m("使用中"),
    PAST_DUE: m("帳款逾期"),
    GRACE_PERIOD: m("寬限期"),
    SUSPENDED: m("已停權"),
    CANCELLED: m("已取消"),
  };
  const warning = ["PAST_DUE", "GRACE_PERIOD", "SUSPENDED"].includes(status);
  return (
    <section className={`mt-5 border-y px-4 py-4 ${warning ? "border-amber-300 bg-amber-50 text-amber-950" : "border-stone-200 bg-white text-stone-900"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><span className="text-sm text-stone-600">{m("訂閱狀態")}</span><strong className="ml-3">{labels[status] ?? status}</strong></div>
        {status === "TRIALING" && trialEndsAt ? <span className="text-sm">{m("試用至 {date}", { date: formatAppDate(locale, trialEndsAt) })}</span> : null}
        {paymentDueAt ? <span className="text-sm">{m("下次到期 {date}", { date: formatAppDate(locale, paymentDueAt) })}</span> : null}
      </div>
      {warning ? <p className="mt-2 text-sm">{m("請儘速確認未付帳單；停權後仍可查看歷史、帳務與提交付款資料。")}</p> : null}
    </section>
  );
}
