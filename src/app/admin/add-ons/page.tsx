import type { ReactNode } from "react";
import { AdminCatalogNavigation } from "@/components/admin-catalog-navigation";
import { getAdminPlanCatalog } from "@/lib/admin-billing-data";
import { getRequestAppLocale } from "@/lib/app-locale-server";
import { addOnLabel, featureLabel } from "@/lib/billing-labels";
import { formatAppCurrency } from "@/lib/locale-format";
import { createAdminTranslator, getAdminCodeLabel } from "@/lib/messages/admin";

type Catalog = Awaited<ReturnType<typeof getAdminPlanCatalog>>;
type AddOn = Catalog["addOns"][number];

const legacyPrefixes = ["ADDITIONAL_STALL_", "ORDER_PACKAGE_"];
const enterpriseFeatures = new Set(["API_ACCESS", "WHITE_LABEL", "SSO", "CUSTOM_DOMAIN"]);

export default async function AdminAddOnsPage() {
  const [{ locale }, { addOns }] = await Promise.all([getRequestAppLocale(), getAdminPlanCatalog()]);
  const m = createAdminTranslator(locale);
  const isLegacy = (item: AddOn) => legacyPrefixes.some((prefix) => item.code.startsWith(prefix));
  const legacy = addOns.filter(isLegacy);
  const comingSoon = addOns.filter((item) => !isLegacy(item) && item.availabilityStatus === "COMING_SOON");
  const enterprise = addOns.filter((item) => !isLegacy(item) && item.availabilityStatus !== "COMING_SOON" && (item.billingType === "CUSTOM" || enterpriseFeatures.has(item.featureCode ?? "")));
  const optional = addOns.filter((item) => !isLegacy(item) && item.availabilityStatus !== "COMING_SOON" && !enterprise.includes(item));

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      <header><h1 className="text-3xl font-semibold">{m("Add-on catalog")}</h1><p className="mt-2 text-sm text-stone-600">{m("Optional external services remain separate from PAYG platform pricing and require explicit activation.")}</p><AdminCatalogNavigation /></header>
      <CatalogSection title={m("Optional services")} description={m("Usage-based or provider-cost services are never enabled merely because they appear in this catalog.")} items={optional} locale={locale} />
      <CatalogSection title={m("Enterprise and manual review")} description={m("Custom commercial terms require administrator approval and an audit trail.")} items={enterprise} locale={locale} />
      {comingSoon.length ? <CatalogSection title={m("Coming soon")} description={m("Coming-soon items remain disabled until their provider and billing contracts are ready.")} items={comingSoon} locale={locale} /> : null}
      {legacy.length ? (
        <details className="mt-8 rounded-md border border-stone-200 bg-stone-50 p-4 sm:p-5">
          <summary className="min-h-11 cursor-pointer py-2 font-semibold">{m("Historical add-ons")}</summary>
          <p className="mt-2 text-sm text-stone-600">{m("Legacy order packages and additional-stall fees remain for historical support but are closed to new PAYG sales.")}</p>
          <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{legacy.map((item) => <AddOnCard key={item.id} item={item} locale={locale} />)}</div>
        </details>
      ) : null}
    </main>
  );
}

function CatalogSection({ title, description, items, locale }: { title: string; description: string; items: AddOn[]; locale: Parameters<typeof formatAppCurrency>[0] }) {
  if (items.length === 0) return null;
  return <section className="mt-7"><h2 className="text-xl font-semibold">{title}</h2><p className="mt-1 text-sm text-stone-600">{description}</p><div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">{items.map((item) => <AddOnCard key={item.id} item={item} locale={locale} />)}</div></section>;
}

function AddOnCard({ item, locale }: { item: AddOn; locale: Parameters<typeof formatAppCurrency>[0] }) {
  const m = createAdminTranslator(locale);
  return (
    <article className="min-w-0 rounded-md border border-stone-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3"><h3 className="break-words font-semibold">{addOnLabel(item.code, item.displayName)}</h3><span className="shrink-0 text-xs">{getAdminCodeLabel(locale, item.availabilityStatus)}</span></div>
      <p className="mt-2 text-sm text-stone-600">{item.description}</p>
      <dl className="mt-4 space-y-2 text-sm">
        <Row label={m("Code")} value={item.code} />
        <Row label={m("Billing type")} value={getAdminCodeLabel(locale, item.billingType)} />
        <Row label={m("Unit price")} value={formatAppCurrency(locale, item.unitPrice, item.currency)} />
        <Row
          label={m("Entitlement")}
          value={item.featureCode ? (
            <span className="flex flex-col items-end">
              <span className="font-medium">{featureLabel(item.featureCode)}</span>
              <span className="mt-0.5 break-all font-mono text-xs text-stone-500">{item.featureCode}</span>
            </span>
          ) : "-"}
        />
        <Row label={m("Manual approval")} value={m(item.requiresManualApproval ? "Yes" : "No")} />
      </dl>
    </article>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return <div className="flex min-w-0 justify-between gap-3"><dt className="shrink-0 text-stone-500">{label}</dt><dd className="min-w-0 break-words text-right">{value}</dd></div>;
}
