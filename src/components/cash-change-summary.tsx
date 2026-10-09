type Props = {
  label: string;
  amount: string;
  insufficient: boolean;
  insufficientLabel: string;
};

export function CashChangeSummary({ label, amount, insufficient, insufficientLabel }: Props) {
  return (
    <div
      data-testid="cash-change-summary"
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className={`mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border-2 px-4 py-4 ${insufficient ? "border-amber-500 bg-amber-50 text-amber-950" : "border-teal-600 bg-teal-50 text-teal-950"}`}
    >
      <span className="text-base font-semibold">{insufficient ? insufficientLabel : label}</span>
      <strong className="min-w-0 break-all text-4xl font-bold tabular-nums tracking-tight">{amount}</strong>
    </div>
  );
}
