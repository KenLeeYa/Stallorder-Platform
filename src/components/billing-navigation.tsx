import Link from "next/link";

export function BillingNavigation({ organizationId, active }: {
  organizationId: string;
  active: "billing" | "plans" | "usage" | "invoices";
}) {
  const items = [
    ["billing", "帳務總覽", "/merchant/billing"],
    ["plans", "方案", "/merchant/plans"],
    ["usage", "用量", "/merchant/usage"],
    ["invoices", "帳單", "/merchant/billing/invoices"],
  ] as const;
  return (
    <nav aria-label="訂閱與帳務" className="mt-6 flex gap-1 overflow-x-auto border-b border-stone-200">
      {items.map(([key, label, href]) => (
        <Link
          key={key}
          href={`${href}?organizationId=${organizationId}`}
          className={`shrink-0 border-b-2 px-3 py-3 text-sm font-semibold ${active === key ? "border-teal-700 text-teal-800" : "border-transparent text-stone-600"}`}
        >
          {label}
        </Link>
      ))}
    </nav>
  );
}

export function BillingPageHeader({ organizationName, organizationId, active, title, description }: {
  organizationName: string;
  organizationId: string;
  active: "billing" | "plans" | "usage" | "invoices";
  title: string;
  description: string;
}) {
  return (
    <header>
      <p className="text-sm font-semibold text-teal-800">{organizationName}</p>
      <h1 className="mt-1 text-3xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-stone-600">{description}</p>
      <BillingNavigation organizationId={organizationId} active={active} />
    </header>
  );
}
