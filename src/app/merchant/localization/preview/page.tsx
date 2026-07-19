import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Eye, ImageOff } from "lucide-react";
import { LocaleFlag } from "@/components/locale-flag";
import { ProductImage } from "@/components/product-image";
import { getLocalizedStallPreview } from "@/lib/localization-data";
import { formatMoney } from "@/lib/money";
import { hasPermission } from "@/lib/rbac";
import { isQrLocale, localizedQrCategory, qrOrderMessages } from "@/lib/qr-order-i18n";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string; stallId?: string; locale?: string }> };

export default async function LocalizationPreviewPage({ searchParams }: PageProps) {
  const { organizationId, stallId, locale: rawLocale } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) notFound();
  if (!stallId || !workspace.stalls.some((stall) => stall.id === stallId) || !rawLocale || !isQrLocale(rawLocale)) notFound();

  const stall = await getLocalizedStallPreview(workspace.id, stallId);
  if (!stall) notFound();
  const locale = rawLocale;
  const copy = qrOrderMessages[locale];
  const products = stall.stallProducts.map((item) => {
    const translation = item.product.translations.find((candidate) => candidate.locale === locale);
    return {
      ...item,
      localizedName: translation?.name || item.product.name,
      localizedDescription: translation?.description || item.product.description,
      category: localizedQrCategory(locale, item.product.category.name),
    };
  });
  const categories = [...new Set(products.map((item) => item.category))];

  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-white px-4 py-6 md:px-8" lang={locale}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 pb-5">
        <div><Link href={`/merchant/localization?organizationId=${workspace.id}`} className="inline-flex min-h-9 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />返回翻譯完整度</Link><h1 className="mt-2 text-3xl font-semibold">{stall.name}</h1><p className="mt-1 text-sm text-stone-500">{stall.location}</p></div>
        <span className="inline-flex min-h-10 items-center gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 text-sm font-semibold text-amber-900"><Eye className="h-4 w-4" /><LocaleFlag locale={locale} />{copy.localeName} · 預覽模式</span>
      </div>
      <div className="border-b border-stone-200 py-4 text-sm text-stone-600">{copy.confirmationNotice}</div>
      {categories.map((category) => (
        <section key={category} className="border-b border-stone-200 py-6">
          <h2 className="text-xl font-semibold">{category}</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {products.filter((item) => item.category === category).map((item) => (
              <article key={item.product.id} className="rounded-md border border-stone-200 bg-white p-4">
                <div className="relative aspect-[16/10] overflow-hidden rounded bg-stone-100">
                  {item.product.imageUrl ? <ProductImage src={item.product.imageUrl} alt={copy.productImage(item.localizedName)} width={800} height={500} sizes="(max-width: 640px) 100vw, 50vw" className="h-full w-full object-cover" /> : <div className="grid h-full place-items-center text-stone-400"><ImageOff className="h-8 w-8" /></div>}
                  {item.isSoldOut ? <span className="absolute inset-x-0 bottom-0 bg-stone-900/90 px-3 py-2 text-center text-sm font-semibold text-white">售罄</span> : null}
                </div>
                <div className="mt-3 flex items-start justify-between gap-3"><div><h3 className="font-semibold">{item.localizedName}</h3>{item.localizedDescription ? <p className="mt-1 text-sm leading-5 text-stone-600">{item.localizedDescription}</p> : null}</div><span className="shrink-0 font-semibold text-teal-800">{formatMoney(item.priceOverride ?? item.product.defaultPrice, stall.currency)}</span></div>
                {item.product.noteGroupAssignments.length ? <div className="mt-3 border-t border-stone-100 pt-3">{item.product.noteGroupAssignments.map(({ noteGroup }) => { const groupName = noteGroup.translations.find((translation) => translation.locale === locale)?.name || noteGroup.name; return <div key={noteGroup.id} className="mt-2 first:mt-0"><p className="text-xs font-semibold text-stone-700">{groupName}{noteGroup.isRequired ? " *" : ""}</p><div className="mt-1 flex flex-wrap gap-1.5">{noteGroup.options.map((option) => <span key={option.id} className="rounded border border-stone-200 px-2 py-1 text-xs text-stone-600">{option.translations.find((translation) => translation.locale === locale)?.name || option.name}{option.priceDelta ? ` +${formatMoney(option.priceDelta, stall.currency)}` : ""}</span>)}</div></div>; })}</div> : null}
              </article>
            ))}
          </div>
        </section>
      ))}
      <p className="py-8 text-center text-sm text-stone-500">此頁僅供商戶檢查翻譯與版面，不會建立訂單。</p>
    </main>
  );
}
