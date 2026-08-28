import { CalendarOff, Flame, MapPin, Package, Store } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import type { AppLocale } from "@/lib/app-locale";
import { publicMessages } from "@/lib/messages/public";
import { formatMoney } from "@/lib/money";
import type { PublicMenu, PublicMenuProduct } from "@/lib/public-menu-types";
import { localizeSpecialClosureTitle } from "@/lib/special-closures-client";
import { LocationGuideDialog } from "./location-guide-dialog";

export function PublicMenuView({ menu, locale }: { menu: PublicMenu; locale: AppLocale }) {
  const sections = groupProductsByCategory(menu.products, locale);
  const mapQuery = menu.stall.address?.trim() || menu.stall.location.trim() || menu.stall.name;
  const encodedMapQuery = encodeURIComponent(mapQuery);
  const googleMapsEmbedKey = process.env.GOOGLE_MAPS_EMBED_API_KEY?.trim();
  const googleMapsEmbedUrl = googleMapsEmbedKey
    ? `https://www.google.com/maps/embed/v1/place?key=${encodeURIComponent(googleMapsEmbedKey)}&q=${encodedMapQuery}`
    : null;
  const googleMapsNavigationUrl = `https://www.google.com/maps/search/?api=1&query=${encodedMapQuery}`;

  return (
    <main data-testid="storefront-menu-view" className="min-h-screen bg-[#f5f1e8] text-stone-950 print:bg-white">
      <header className="border-b border-stone-900/10 bg-[#0f766e] text-white print:border-stone-300 print:bg-white print:text-stone-950">
        <div className="relative isolate mx-auto max-w-6xl overflow-hidden px-4 py-8 sm:px-6 sm:py-11 lg:px-8">
          {menu.stall.coverImageUrl ? <div data-testid="public-menu-cover-image" className="absolute inset-0 -z-10 overflow-hidden bg-teal-950 print:hidden">
            <ProductImage
              src={menu.stall.coverImageUrl}
              alt={menu.stall.name}
              width={1600}
              height={500}
              sizes="(min-width: 1152px) 1152px, 100vw"
              className="h-full w-full object-cover"
              style={{
                objectPosition: `${menu.stall.coverImagePositionX ?? 50}% ${menu.stall.coverImagePositionY ?? 50}%`,
                transform: `scale(${(menu.stall.coverImageZoom ?? 100) / 100})`,
                transformOrigin: `${menu.stall.coverImagePositionX ?? 50}% ${menu.stall.coverImagePositionY ?? 50}%`,
              }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-teal-950/90 via-teal-900/75 to-teal-950/45" />
          </div> : null}
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 print:border print:border-stone-300">
              <Store className="h-7 w-7" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-[0.18em] text-teal-50 print:text-stone-500">
                {publicMessages.get(locale, "menuEyebrow")}
              </p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{menu.stall.name}</h1>
              {menu.stall.location ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-teal-50 print:text-stone-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{menu.stall.location}</span>
                </p>
              ) : null}
              <LocationGuideDialog
                stallName={menu.stall.name}
                location={menu.stall.location}
                address={menu.stall.address ?? ""}
                guideImageUrl={menu.stall.locationGuideImageUrl ?? null}
                googleMapsEmbedUrl={googleMapsEmbedUrl}
                googleMapsNavigationUrl={googleMapsNavigationUrl}
                locale={locale}
              />
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-sm leading-6 text-teal-50 print:text-stone-600">
            {publicMessages.get(locale, "menuDescription")}
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9 lg:px-8">
        {menu.specialClosure ? (
          <section
            role={menu.specialClosure.isActive ? "alert" : "status"}
            data-testid="public-menu-special-closure"
            className={`mb-7 flex items-start gap-3 rounded-2xl border p-4 shadow-sm ${menu.specialClosure.isActive ? "border-red-300 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}
          >
            <CalendarOff className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
            <div>
              <h2 className="font-bold">{localizeSpecialClosureTitle(menu.specialClosure.title, locale)}</h2>
              <p className="mt-1 text-sm font-semibold">{formatClosureRange(menu.specialClosure, locale)}</p>
              {menu.specialClosure.message ? <p className="mt-1 text-sm leading-6">{menu.specialClosure.message}</p> : null}
            </div>
          </section>
        ) : null}
        {sections.length > 1 ? (
          <nav data-testid="public-menu-category-navigation" aria-label={publicMessages.get(locale, "menuCategoryNavigation")} className="sticky top-0 z-20 -mx-4 mb-7 flex gap-2 overflow-x-auto border-y border-stone-200 bg-[#f5f1e8]/95 px-4 py-3 shadow-sm backdrop-blur print:hidden sm:mx-0 sm:px-3">
            {sections.map((section, index) => (
              <a
                key={section.category}
                href={`#menu-category-${index + 1}`}
                className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 shadow-sm hover:border-teal-600 hover:text-teal-800"
              >
                {section.localizedCategory}
              </a>
            ))}
          </nav>
        ) : null}

        {sections.length === 0 ? (
          <section className="rounded-2xl border border-stone-200 bg-white px-5 py-14 text-center shadow-sm">
            <Package className="mx-auto h-9 w-9 text-stone-400" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold">{publicMessages.get(locale, "menuEmptyTitle")}</h2>
            <p className="mt-2 text-sm text-stone-600">{publicMessages.get(locale, "menuEmptyDescription")}</p>
          </section>
        ) : (
          <div className="space-y-10 print:space-y-7">
            {sections.map((section, index) => (
              <section key={section.category} id={`menu-category-${index + 1}`} className="scroll-mt-20" aria-labelledby={`menu-category-title-${index + 1}`}>
                <div className="mb-4 flex items-end justify-between gap-3 border-b-2 border-stone-900 pb-2">
                  <h2 id={`menu-category-title-${index + 1}`} className="text-2xl font-bold tracking-tight">{section.localizedCategory}</h2>
                  <span className="shrink-0 text-xs font-medium text-stone-500">
                    {publicMessages.get(locale, "menuItemCount", { count: section.products.length })}
                  </span>
                </div>
                <div className="space-y-6">
                  {section.groups.map((group, groupIndex) => (
                    <div key={`${section.category}-${group.name ?? "ungrouped"}-${groupIndex}`}>
                      {group.name ? <h3 className="mb-3 text-sm font-bold uppercase tracking-wide text-teal-800">{group.localizedName}</h3> : null}
                      <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2">
                        {group.products.map((product) => (
                          <MenuProductCard key={product.id} product={product} currency={menu.stall.currency} locale={locale} />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-10 border-t border-stone-300 py-5 text-center text-xs leading-5 text-stone-500">
          {publicMessages.get(locale, "menuFooter")}
        </footer>
      </div>
    </main>
  );
}

function formatClosureRange(
  closure: NonNullable<PublicMenu["specialClosure"]>,
  locale: AppLocale,
) {
  const formatter = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const start = formatter.format(new Date(`${closure.startsOn}T00:00:00.000Z`));
  if (closure.startsOn === closure.endsOn) return start;
  const end = formatter.format(new Date(`${closure.endsOn}T00:00:00.000Z`));
  return `${start} – ${end}`;
}

function MenuProductCard({
  product,
  currency,
  locale,
}: {
  product: PublicMenuProduct;
  currency: string;
  locale: AppLocale;
}) {
  const productTranslation = product.translations.find((translation) => translation.locale === locale);
  const productName = productTranslation?.name || product.name;
  const productDescription = productTranslation?.description || product.description;
  const formatPriceDelta = (priceDelta: number) => (
    priceDelta === 0 ? "" : ` (${priceDelta > 0 ? "+" : ""}${formatMoney(priceDelta, currency, locale)})`
  );
  const bundleSummary = product.kind === "BUNDLE"
    ? product.bundleChoiceGroups.map((group) => {
      const choices = group.options.map((option) => (
        `${option.componentProductName}${option.quantity > 1 ? ` × ${option.quantity}` : ""}${formatPriceDelta(option.priceDelta)}`
      ));
      return `${group.name} (${group.minSelections}${group.maxSelections !== group.minSelections ? `–${group.maxSelections}` : ""}): ${choices.join(", ")}`;
    }).join("; ")
    : "";
  const notePriceSummary = product.noteGroups.flatMap((group) => {
    const groupName = group.translations.find((translation) => translation.locale === locale)?.name || group.name;
    const pricedOptions = group.options
      .filter((option) => option.priceDelta !== 0)
      .map((option) => `${option.translations.find((translation) => translation.locale === locale)?.name || option.name}${formatPriceDelta(option.priceDelta)}`);
    return pricedOptions.length > 0 ? [`${groupName}: ${pricedOptions.join(", ")}`] : [];
  }).join("; ");
  const hasPriceAdjustments = notePriceSummary.length > 0 || product.bundleChoiceGroups.some(
    (group) => group.options.some((option) => option.priceDelta !== 0),
  );

  return (
    <article
      data-testid={product.isSoldOut ? "public-menu-sold-out" : undefined}
      className={`break-inside-avoid overflow-hidden rounded-2xl border shadow-sm print:rounded-none print:shadow-none ${product.isSoldOut ? "border-stone-300 bg-stone-100" : "border-stone-200 bg-white"}`}
    >
      <div className="grid min-h-36 grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[144px_minmax(0,1fr)]">
        <div className="relative min-h-36 overflow-hidden bg-stone-100">
          {product.imageUrl ? (
            <ProductImage
              src={product.imageUrl}
              alt={publicMessages.get(locale, "menuProductImage", { name: productName })}
              width={432}
              height={432}
              sizes="(max-width: 639px) 112px, 144px"
              className={`h-full w-full object-cover ${product.isSoldOut ? "grayscale opacity-45" : ""}`}
            />
          ) : (
            <div className="grid h-full min-h-36 place-items-center text-stone-300">
              <Store className="h-9 w-9" aria-hidden="true" />
            </div>
          )}
          {product.isSoldOut ? <span className="absolute inset-0 grid place-items-center bg-stone-950/45 px-2 text-center text-sm font-black text-white">{publicMessages.get(locale, "menuSoldOut")}</span> : null}
        </div>
        <div className="flex min-w-0 flex-col p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {product.kind === "BUNDLE" ? <span className="rounded-full bg-teal-50 px-2 py-1 text-[11px] font-bold text-teal-800">{publicMessages.get(locale, "menuBundleBadge")}</span> : null}
            {product.isBestSeller ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">
                <Flame className="h-3 w-3" aria-hidden="true" />{publicMessages.get(locale, "menuBestSeller")}
              </span>
            ) : null}
            {product.isSoldOut ? <span className="rounded-full bg-stone-700 px-2 py-1 text-[11px] font-bold text-white">{publicMessages.get(locale, "menuSoldOut")}</span> : null}
          </div>
          <h3 className="mt-2 text-lg font-bold leading-6">{productName}</h3>
          {productDescription ? <p className="mt-1 line-clamp-3 text-sm leading-5 text-stone-600 print:line-clamp-none">{productDescription}</p> : null}
          {bundleSummary ? <p className="mt-2 text-xs leading-5 text-stone-500">{bundleSummary}</p> : null}
          {notePriceSummary ? <p className="mt-2 text-xs leading-5 text-stone-500">{publicMessages.get(locale, "menuCustomOptions", { options: notePriceSummary })}</p> : null}
          <p className="mt-auto pt-3 text-right text-lg font-black text-teal-800 print:text-stone-950">
            {hasPriceAdjustments ? <span className="mr-1 text-xs font-semibold text-stone-500">{publicMessages.get(locale, "menuFromPrice")}</span> : null}
            {formatMoney(product.price, currency, locale)}
          </p>
        </div>
      </div>
    </article>
  );
}

function groupProductsByCategory(products: PublicMenuProduct[], locale: AppLocale) {
  const productsByCategory = new Map<string, PublicMenuProduct[]>();
  for (const product of products) {
    const categoryProducts = productsByCategory.get(product.category);
    if (categoryProducts) categoryProducts.push(product);
    else productsByCategory.set(product.category, [product]);
  }
  return [...productsByCategory].map(([category, categoryProducts]) => {
    const productsByGroup = new Map<string | null, PublicMenuProduct[]>();
    for (const product of categoryProducts) {
      const group = product.group?.trim() || null;
      const groupedProducts = productsByGroup.get(group);
      if (groupedProducts) groupedProducts.push(product);
      else productsByGroup.set(group, [product]);
    }
    return {
      category,
      localizedCategory: categoryProducts[0]?.categoryTranslations?.find((translation) => translation.locale === locale)?.name
        || category,
      products: categoryProducts,
      groups: [...productsByGroup].map(([name, groupedProducts]) => ({
        name,
        localizedName: groupedProducts[0]?.groupTranslations?.find((translation) => translation.locale === locale)?.name
          || name,
        products: groupedProducts,
      })),
    };
  });
}
