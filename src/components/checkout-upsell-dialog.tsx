"use client";

import { Plus, ShoppingBag, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { ProductImage } from "@/components/product-image";
import { formatMoney } from "@/lib/money";
import type { PublicMenuProduct } from "@/lib/public-menu-types";
import type { QrOrderMessages } from "@/lib/qr-order-i18n";

export function CheckoutUpsellDialog({
  products,
  addedProductIds,
  currency,
  locale,
  copy,
  localizedProduct,
  onAdd,
  onContinue,
}: {
  products: PublicMenuProduct[];
  addedProductIds: ReadonlySet<string>;
  currency: string;
  locale: string;
  copy: QrOrderMessages;
  localizedProduct: (product: PublicMenuProduct) => { name: string; description?: string };
  onAdd: (product: PublicMenuProduct) => void;
  onContinue: () => void;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const hasAdded = products.some((product) => addedProductIds.has(product.id));

  useEffect(() => {
    dialogRef.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onContinue();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onContinue]);

  return (
    <div className="fixed inset-0 z-[80] grid place-items-center overflow-y-auto bg-stone-950/70 p-3 sm:p-6">
      <section ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="checkout-upsell-title" className="relative my-auto w-full max-w-2xl rounded-2xl bg-white p-5 shadow-2xl sm:p-7">
        <button type="button" aria-label={copy.close} onClick={onContinue} className="absolute right-3 top-3 grid h-11 w-11 place-items-center rounded-full text-stone-500 hover:bg-stone-100">
          <X aria-hidden="true" className="h-5 w-5" />
        </button>
        <div className="flex items-start gap-3 pr-12">
          <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-teal-100 text-teal-800"><ShoppingBag className="h-6 w-6" aria-hidden="true" /></span>
          <div><h2 id="checkout-upsell-title" className="text-2xl font-bold text-stone-950">{copy.upsellTitle}</h2><p className="mt-1 text-sm leading-6 text-stone-600">{copy.upsellDescription}</p></div>
        </div>
        <div className="mt-5 grid max-h-[55dvh] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
          {products.map((product) => {
            const localized = localizedProduct(product);
            const added = addedProductIds.has(product.id);
            const configurable = product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
            return (
              <article key={product.id} className="overflow-hidden rounded-xl border border-stone-200 bg-stone-50">
                <div className="flex min-h-28 items-stretch">
                  {product.imageUrl ? <ProductImage src={product.imageUrl} alt={localized.name} width={112} height={112} sizes="112px" className="w-28 shrink-0 object-cover" /> : <div className="grid w-28 shrink-0 place-items-center bg-teal-50 text-teal-700"><ShoppingBag className="h-8 w-8" aria-hidden="true" /></div>}
                  <div className="flex min-w-0 flex-1 flex-col p-3">
                    <h3 className="line-clamp-2 text-base font-semibold text-stone-950">{localized.name}</h3>
                    <p className="mt-1 text-sm font-bold text-teal-800">{formatMoney(product.price, currency, locale)}</p>
                    <button type="button" disabled={added} onClick={() => onAdd(product)} className="mt-auto inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white disabled:bg-emerald-100 disabled:text-emerald-900">
                      {added ? null : configurable ? <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> : <Plus className="h-4 w-4" aria-hidden="true" />}
                      {added ? copy.upsellAdded : configurable ? copy.upsellChooseOptions : copy.upsellAdd}
                    </button>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
        <button type="button" onClick={onContinue} className={`mt-5 min-h-12 w-full rounded-md px-4 font-semibold ${hasAdded ? "bg-teal-800 text-white" : "border border-stone-300 bg-white text-stone-800"}`}>
          {hasAdded ? copy.upsellContinue : copy.upsellSkip}
        </button>
      </section>
    </div>
  );
}
