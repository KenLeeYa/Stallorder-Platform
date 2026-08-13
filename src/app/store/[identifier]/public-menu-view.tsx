import { Flame, MapPin, Package, Store } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { formatMoney } from "@/lib/money";
import type { PublicMenu, PublicMenuProduct } from "@/lib/public-menu-types";

export function PublicMenuView({ menu }: { menu: PublicMenu }) {
  const sections = groupProductsByCategory(menu.products);

  return (
    <main data-testid="storefront-menu-view" className="min-h-screen bg-[#f5f1e8] text-stone-950 print:bg-white">
      <header className="border-b border-stone-900/10 bg-[#0f766e] text-white print:border-stone-300 print:bg-white print:text-stone-950">
        <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 sm:py-11 lg:px-8">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-white/15 print:border print:border-stone-300">
              <Store className="h-7 w-7" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold tracking-[0.18em] text-teal-50 print:text-stone-500">MENU · 公開菜單</p>
              <h1 className="mt-2 text-3xl font-bold tracking-tight sm:text-4xl">{menu.stall.name}</h1>
              {menu.stall.location ? (
                <p className="mt-3 flex items-start gap-2 text-sm text-teal-50 print:text-stone-600">
                  <MapPin className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>{menu.stall.location}</span>
                </p>
              ) : null}
            </div>
          </div>
          <p className="mt-6 max-w-2xl text-sm leading-6 text-teal-50 print:text-stone-600">
            此頁僅供瀏覽，顯示目前上架、啟用且可供應的商品與套餐；實際供應情況請以商家現場為準。
          </p>
        </div>
      </header>

      <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-9 lg:px-8">
        {sections.length > 1 ? (
          <nav aria-label="菜單分類" className="-mx-4 mb-7 flex gap-2 overflow-x-auto px-4 pb-2 print:hidden sm:mx-0 sm:px-0">
            {sections.map((section, index) => (
              <a
                key={section.category}
                href={`#menu-category-${index + 1}`}
                className="inline-flex min-h-10 shrink-0 items-center rounded-full border border-stone-300 bg-white px-4 text-sm font-semibold text-stone-800 shadow-sm hover:border-teal-600 hover:text-teal-800"
              >
                {section.category}
              </a>
            ))}
          </nav>
        ) : null}

        {sections.length === 0 ? (
          <section className="rounded-2xl border border-stone-200 bg-white px-5 py-14 text-center shadow-sm">
            <Package className="mx-auto h-9 w-9 text-stone-400" aria-hidden="true" />
            <h2 className="mt-4 text-xl font-semibold">目前沒有供應中的品項</h2>
            <p className="mt-2 text-sm text-stone-600">商家更新商品後，這個連結會自動顯示最新菜單。</p>
          </section>
        ) : (
          <div className="space-y-10 print:space-y-7">
            {sections.map((section, index) => (
              <section key={section.category} id={`menu-category-${index + 1}`} className="scroll-mt-4" aria-labelledby={`menu-category-title-${index + 1}`}>
                <div className="mb-4 flex items-end justify-between gap-3 border-b-2 border-stone-900 pb-2">
                  <h2 id={`menu-category-title-${index + 1}`} className="text-2xl font-bold tracking-tight">{section.category}</h2>
                  <span className="shrink-0 text-xs font-medium text-stone-500">{section.products.length} 品項</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2 print:grid-cols-2">
                  {section.products.map((product) => (
                    <MenuProductCard key={product.id} product={product} currency={menu.stall.currency} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}

        <footer className="mt-10 border-t border-stone-300 py-5 text-center text-xs leading-5 text-stone-500">
          菜單由商家即時維護 · 價格與供應內容如有變動，以商家公告為準
        </footer>
      </div>
    </main>
  );
}

function MenuProductCard({ product, currency }: { product: PublicMenuProduct; currency: string }) {
  const formatPriceDelta = (priceDelta: number) => (
    priceDelta === 0 ? "" : `（${priceDelta > 0 ? "+" : ""}${formatMoney(priceDelta, currency)}）`
  );
  const bundleSummary = product.kind === "BUNDLE"
    ? product.bundleChoiceGroups.map((group) => {
      const choices = group.options.map((option) => (
        `${option.componentProductName}${option.quantity > 1 ? ` × ${option.quantity}` : ""}${formatPriceDelta(option.priceDelta)}`
      ));
      return `${group.name}（選 ${group.minSelections}${group.maxSelections !== group.minSelections ? `～${group.maxSelections}` : ""}）：${choices.join("、")}`;
    }).join("；")
    : "";
  const notePriceSummary = product.noteGroups.flatMap((group) => {
    const pricedOptions = group.options
      .filter((option) => option.priceDelta !== 0)
      .map((option) => `${option.name}${formatPriceDelta(option.priceDelta)}`);
    return pricedOptions.length > 0 ? [`${group.name}：${pricedOptions.join("、")}`] : [];
  }).join("；");
  const hasPriceAdjustments = notePriceSummary.length > 0 || product.bundleChoiceGroups.some(
    (group) => group.options.some((option) => option.priceDelta !== 0),
  );

  return (
    <article className="break-inside-avoid overflow-hidden rounded-2xl border border-stone-200 bg-white shadow-sm print:rounded-none print:shadow-none">
      <div className="grid min-h-36 grid-cols-[112px_minmax(0,1fr)] sm:grid-cols-[144px_minmax(0,1fr)]">
        <div className="relative min-h-36 overflow-hidden bg-stone-100">
          {product.imageUrl ? (
            <ProductImage
              src={product.imageUrl}
              alt={`${product.name} 商品圖片`}
              width={432}
              height={432}
              sizes="(max-width: 639px) 112px, 144px"
              className="h-full w-full object-cover"
            />
          ) : (
            <div className="grid h-full min-h-36 place-items-center text-stone-300">
              <Store className="h-9 w-9" aria-hidden="true" />
            </div>
          )}
        </div>
        <div className="flex min-w-0 flex-col p-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {product.kind === "BUNDLE" ? <span className="rounded-full bg-teal-50 px-2 py-1 text-[11px] font-bold text-teal-800">套餐</span> : null}
            {product.isBestSeller ? (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-[11px] font-bold text-amber-900">
                <Flame className="h-3 w-3" aria-hidden="true" />熱銷
              </span>
            ) : null}
          </div>
          <h3 className="mt-2 text-lg font-bold leading-6">{product.name}</h3>
          {product.description ? <p className="mt-1 line-clamp-3 text-sm leading-5 text-stone-600 print:line-clamp-none">{product.description}</p> : null}
          {bundleSummary ? <p className="mt-2 text-xs leading-5 text-stone-500">{bundleSummary}</p> : null}
          {notePriceSummary ? <p className="mt-2 text-xs leading-5 text-stone-500">價格調整：{notePriceSummary}</p> : null}
          <p className="mt-auto pt-3 text-right text-lg font-black text-teal-800 print:text-stone-950">
            {hasPriceAdjustments ? <span className="mr-1 text-xs font-semibold text-stone-500">基本價</span> : null}
            {formatMoney(product.price, currency)}
          </p>
        </div>
      </div>
    </article>
  );
}

function groupProductsByCategory(products: PublicMenuProduct[]) {
  const productsByCategory = new Map<string, PublicMenuProduct[]>();
  for (const product of products) {
    const categoryProducts = productsByCategory.get(product.category);
    if (categoryProducts) categoryProducts.push(product);
    else productsByCategory.set(product.category, [product]);
  }
  return [...productsByCategory].map(([category, categoryProducts]) => ({
    category,
    products: categoryProducts,
  }));
}
