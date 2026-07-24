const labels: Record<string, string> = {
  TRIALING: "試用中",
  ACTIVE: "使用中",
  PAST_DUE: "帳款逾期",
  GRACE_PERIOD: "寬限期",
  SUSPENDED: "已停權",
  CANCELLED: "已取消",
};

export function BillingStatusBanner({ status, trialEndsAt, paymentDueAt }: {
  status: string;
  trialEndsAt?: Date | null;
  paymentDueAt?: Date | null;
}) {
  const warning = ["PAST_DUE", "GRACE_PERIOD", "SUSPENDED"].includes(status);
  return (
    <section className={`mt-5 border-y px-4 py-4 ${warning ? "border-amber-300 bg-amber-50 text-amber-950" : "border-stone-200 bg-white text-stone-900"}`}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><span className="text-sm text-stone-600">訂閱狀態</span><strong className="ml-3">{labels[status] ?? status}</strong></div>
        {status === "TRIALING" && trialEndsAt ? <span className="text-sm">試用至 {formatDate(trialEndsAt)}</span> : null}
        {paymentDueAt ? <span className="text-sm">下次到期 {formatDate(paymentDueAt)}</span> : null}
      </div>
      {warning ? <p className="mt-2 text-sm">請儘速確認未付帳單；停權後仍可查看歷史、帳務與提交付款資料。</p> : null}
    </section>
  );
}

function formatDate(value: Date) {
  return value.toISOString().slice(0, 10);
}
