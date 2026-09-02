import { Fragment, type RefObject } from "react";
import { Flame, Minus, Plus, ShoppingCart, X } from "lucide-react";
import { ProductImage } from "@/components/product-image";
import type { QrProductDraft } from "@/components/qr-order-product-controller";
import { formatMoney } from "@/lib/money";
import {
  bundlePriceAdjustment,
  bundleSelectionIsValid,
} from "@/lib/product-bundle-selection";
import { notePriceAdjustment, noteSelectionIsValid } from "@/lib/product-note-selection";
import {
  qrCartProductQuantity,
  type QrCartLine,
  type QrCartOrderingMode,
} from "@/lib/qr-cart";
import type {
  PublicMenuBundleChoiceGroup,
  PublicMenuBundleChoiceOption,
  PublicMenuNoteGroup,
  PublicMenuNoteOption,
  PublicMenuProduct,
} from "@/lib/public-menu-types";
import { qrOrderMessages, type QrLocale } from "@/lib/qr-order-i18n";

type QrOrderMenuProps = {
  categories: string[];
  visibleProducts: PublicMenuProduct[];
  activeOrderingMode: QrCartOrderingMode;
  scheduledPickupAt: string;
  currency: string;
  locale: QrLocale;
  copy: (typeof qrOrderMessages)[QrLocale];
  orderingEnabled: boolean;
  cartLines: QrCartLine[];
  productDrafts: Record<string, QrProductDraft>;
  editingLineIds: Record<string, string>;
  configuringProductId: string | null;
  sessionExpiryDialogOpen: boolean;
  configurationRef: RefObject<HTMLElement | null>;
  localizedCategory: (category: string) => string;
  localizedProduct: (product: PublicMenuProduct) => { name: string; description: string };
  localizedProductGroup: (product: PublicMenuProduct) => string;
  localizedGroupName: (group: PublicMenuNoteGroup) => string;
  localizedOptionName: (option: PublicMenuNoteOption) => string;
  bundleChoiceLabel: (option: PublicMenuBundleChoiceOption) => string;
  onUpdateQuantity: (productId: string, quantity: number) => void;
  onCancelConfiguration: (productId: string) => void;
  onSelectNoteOption: (
    productId: string,
    group: PublicMenuNoteGroup,
    optionId: string | null,
  ) => void;
  onSelectBundleChoice: (
    productId: string,
    group: PublicMenuBundleChoiceGroup,
    optionId: string | null,
  ) => void;
  onAddProduct: (product: PublicMenuProduct) => void;
};

export function QrOrderMenu({
  categories,
  visibleProducts,
  activeOrderingMode,
  scheduledPickupAt,
  currency,
  locale,
  copy,
  orderingEnabled,
  cartLines,
  productDrafts,
  editingLineIds,
  configuringProductId,
  sessionExpiryDialogOpen,
  configurationRef,
  localizedCategory,
  localizedProduct,
  localizedProductGroup,
  localizedGroupName,
  localizedOptionName,
  bundleChoiceLabel,
  onUpdateQuantity,
  onCancelConfiguration,
  onSelectNoteOption,
  onSelectBundleChoice,
  onAddProduct,
}: QrOrderMenuProps) {
  return (
    <>
      {categories.length > 0 ? (
        <nav data-testid="qr-category-navigation" aria-label={copy.categoryNavigation} style={{ position: "sticky", top: "var(--storefront-mode-nav-height, 0px)" }} className="z-30 -mx-4 mt-5 flex gap-2 overflow-x-auto border-y border-stone-200 bg-stone-50/95 px-4 py-2 backdrop-blur sm:mx-0 sm:px-3">
          {categories.map((category, index) => (
            <a key={category} href={`#qr-category-${index}`} className="inline-flex min-h-10 shrink-0 items-center rounded-md border border-stone-300 bg-white px-3 text-sm font-semibold text-stone-700">
              {localizedCategory(category)}
            </a>
          ))}
        </nav>
      ) : null}

      <div className="mt-5 space-y-6 sm:mt-6 sm:space-y-7">
        {activeOrderingMode === "PREORDER" && !scheduledPickupAt ? (
          <p role="status" className="rounded-lg border border-sky-200 bg-sky-50 p-4 text-sm font-medium text-sky-950">
            {copy.applyPreorderTimeGuidance}
          </p>
        ) : activeOrderingMode === "PREORDER" && visibleProducts.length === 0 ? (
          <p role="status" className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm font-medium text-amber-950">
            {copy.noProductsForSlot}
          </p>
        ) : null}
        {categories.map((category, categoryIndex) => (
          <section key={category} id={`qr-category-${categoryIndex}`} style={{ scrollMarginTop: "calc(var(--storefront-mode-nav-height, 0px) + 5rem)" }}>
            <h2 className="mb-2 text-sm font-semibold text-stone-500 sm:mb-3">{localizedCategory(category)}</h2>
            <div className="grid gap-2 sm:gap-3">
              {visibleProducts.filter((product) => product.category === category).map((product, productIndex, categoryProducts) => {
                const configurable = product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
                const soldOut = product.isSoldOut;
                const showGroupHeading = Boolean(product.group)
                  && product.group !== categoryProducts[productIndex - 1]?.group;
                const draft = productDrafts[product.id] ?? {
                  quantity: 0,
                  noteOptionIds: [],
                  bundleChoiceIds: [],
                };
                const committedQuantity = qrCartProductQuantity(cartLines, product.id);
                const displayedQuantity = configurable ? draft.quantity : committedQuantity;
                const configurationComplete = noteSelectionIsValid(product.noteGroups, draft.noteOptionIds)
                  && bundleSelectionIsValid(product.bundleChoiceGroups, draft.bundleChoiceIds);
                return (
                  <Fragment key={product.id}>
                  {showGroupHeading ? <p data-testid="qr-product-group-heading" className="col-span-full mt-2 text-xs font-bold uppercase tracking-wide text-teal-800 first:mt-0">{localizedProductGroup(product)}</p> : null}
                  <article
                    id={`qr-product-${product.id}`}
                    data-best-seller-rank={product.rank ?? undefined}
                    tabIndex={-1}
                    className={`rounded-lg border p-3 sm:p-4 ${soldOut ? "border-stone-300 bg-stone-100" : "border-stone-200 bg-white"}`}
                  >
                    <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-4">
                      <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-md bg-stone-100 sm:h-20 sm:w-20">
                        {product.imageUrl ? <ProductImage src={product.imageUrl} alt={copy.productImage(localizedProduct(product).name)} width={80} height={80} sizes="(max-width: 639px) 56px, 80px" className={`h-full w-full object-cover ${soldOut ? "grayscale opacity-45" : ""}`} /> : <div aria-hidden="true" className={`h-full w-full bg-stone-100 ${soldOut ? "opacity-45" : ""}`} />}
                        {soldOut ? <span data-testid="sold-out-image-overlay" className="absolute inset-0 grid place-items-center bg-stone-950/45 px-1 text-center text-xs font-black text-white">{copy.soldOutBadge}</span> : null}
                      </div>
                      <div className="min-w-0 flex-1">
                        {product.isBestSeller ? <span data-testid="best-seller-badge" className="mb-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950"><Flame aria-hidden="true" className="h-3.5 w-3.5" />{copy.hotSellerBadge}</span> : null}
                        {soldOut ? <span data-testid="sold-out-badge" className="mb-1 ml-1 inline-flex rounded-full bg-stone-700 px-2 py-1 text-xs font-semibold text-white">{copy.soldOutBadge}</span> : null}
                        {!product.isOrderDiscountEligible ? <span data-testid="discount-ineligible-badge" className="mb-1 ml-1 inline-flex rounded-full bg-stone-100 px-2 py-1 text-xs font-semibold text-stone-700">{copy.discountIneligible}</span> : null}
                        <h3 className="font-semibold">{localizedProduct(product).name}</h3>
                        <p className="mt-1 line-clamp-2 text-sm leading-5 text-stone-600">{localizedProduct(product).description}</p>
                        <p className="mt-2 font-semibold">{formatMoney(Math.max(
                          0,
                          product.price
                            + notePriceAdjustment(product.noteGroups, draft.noteOptionIds)
                            + bundlePriceAdjustment(product.bundleChoiceGroups, draft.bundleChoiceIds),
                        ), currency, locale)}</p>
                        {configurable && committedQuantity > 0 ? <p className="mt-1 text-xs font-medium text-teal-800">{copy.cartProductQuantity(committedQuantity)}</p> : null}
                      </div>
                      <div aria-hidden={configuringProductId === product.id ? true : undefined} className="col-span-2 flex items-center justify-self-end gap-2 sm:col-span-1">
                        {configurable ? (
                          <button
                            type="button"
                            data-testid="qr-open-product-configurator"
                            disabled={soldOut || !orderingEnabled || configuringProductId === product.id}
                            onClick={() => onUpdateQuantity(product.id, displayedQuantity > 0 ? displayedQuantity : 1)}
                            className="inline-flex min-h-14 min-w-32 items-center justify-center rounded-lg border-2 border-teal-700 bg-teal-50 px-4 text-sm font-bold text-teal-900 disabled:opacity-40"
                          >
                            {editingLineIds[product.id] ? copy.editCartItem : copy.upsellChooseOptions}
                          </button>
                        ) : (
                          <>
                            <button type="button" title={copy.decrease(localizedProduct(product).name)} aria-label={copy.decrease(localizedProduct(product).name)} disabled={soldOut || !orderingEnabled || displayedQuantity <= 0} onClick={() => onUpdateQuantity(product.id, displayedQuantity - 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 disabled:opacity-40">
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="w-8 text-center font-semibold">{displayedQuantity}</span>
                            <button type="button" title={copy.increase(localizedProduct(product).name)} aria-label={copy.increase(localizedProduct(product).name)} disabled={soldOut || !orderingEnabled} onClick={() => onUpdateQuantity(product.id, displayedQuantity + 1)} className="grid h-11 w-11 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-40">
                              <Plus className="h-4 w-4" />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                    {!soldOut && configurable && configuringProductId === product.id && !sessionExpiryDialogOpen && draft.quantity > 0 ? (
                      <div className="fixed inset-0 z-[76] flex items-end justify-center bg-black/60 sm:items-center sm:p-4">
                        <section
                          ref={configurationRef}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby={`qr-product-configuration-${product.id}`}
                          tabIndex={-1}
                          data-testid="qr-product-configuration"
                          className="flex max-h-[100dvh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl bg-white text-stone-900 shadow-2xl outline-none sm:max-h-[calc(100dvh-2rem)] sm:rounded-2xl"
                        >
                          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-stone-200 px-4 py-4 sm:px-6">
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-teal-800">{copy.upsellChooseOptions}</p>
                              <h2 id={`qr-product-configuration-${product.id}`} className="mt-1 break-words text-xl font-semibold">{localizedProduct(product).name}</h2>
                              <p className="mt-1 text-sm font-semibold text-stone-700">{formatMoney(Math.max(
                                0,
                                product.price
                                  + notePriceAdjustment(product.noteGroups, draft.noteOptionIds)
                                  + bundlePriceAdjustment(product.bundleChoiceGroups, draft.bundleChoiceIds),
                              ), currency, locale)}</p>
                            </div>
                            <button type="button" title={copy.close} aria-label={copy.close} onClick={() => onCancelConfiguration(product.id)} className="grid h-12 w-12 shrink-0 place-items-center rounded-xl border border-stone-300 bg-white">
                              <X className="h-5 w-5" />
                            </button>
                          </header>
                          <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6">
                            {draft.quantity > 0 && product.noteGroups.length > 0 ? (
                            <div className="space-y-6">
                              {product.noteGroups.map((group) => {
                                const groupOptionIds = new Set(group.options.map((option) => option.id));
                                const selectedCount = draft.noteOptionIds.filter((id) => groupOptionIds.has(id)).length;
                                const maximumReached = group.maxSelections !== null && selectedCount >= group.maxSelections;
                                const role = group.selectionMode === "SINGLE" ? "radio" : "checkbox";
                                return (
                                  <section key={group.id} aria-labelledby={`qr-configurator-note-${group.id}`}>
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                      <h3 id={`qr-configurator-note-${group.id}`} className="text-base font-bold">{localizedGroupName(group)}{group.isRequired ? " *" : ""}</h3>
                                      <span className="text-xs font-semibold text-stone-500">{group.selectionMode === "SINGLE" ? copy.singleChoice : group.maxSelections ? copy.maxSelections(group.maxSelections) : copy.multipleChoice}</span>
                                    </div>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2" role={role === "radio" ? "radiogroup" : "group"} aria-labelledby={`qr-configurator-note-${group.id}`}>
                                      {role === "radio" && !group.isRequired ? <button type="button" data-testid="qr-configurator-option" role="radio" aria-checked={selectedCount === 0} disabled={!orderingEnabled} onClick={() => onSelectNoteOption(product.id, group, null)} className={`flex min-h-14 items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold disabled:opacity-40 ${selectedCount === 0 ? "border-teal-700 bg-teal-50 text-teal-950" : "border-stone-300 bg-white text-stone-800"}`}><span>{copy.noSelection}</span><SelectionMark selected={selectedCount === 0} /></button> : null}
                                      {group.options.map((option) => {
                                        const checked = draft.noteOptionIds.includes(option.id);
                                        return <button key={option.id} type="button" data-testid="qr-configurator-option" role={role} aria-checked={checked} disabled={!orderingEnabled || (role === "checkbox" && maximumReached && !checked)} onClick={() => onSelectNoteOption(product.id, group, option.id)} className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold disabled:opacity-40 ${checked ? "border-teal-700 bg-teal-50 text-teal-950" : "border-stone-300 bg-white text-stone-800"}`}><span>{localizedOptionName(option)}{option.priceDelta !== 0 ? <span className="ml-2 text-teal-800">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, currency, locale)}</span> : null}</span><SelectionMark selected={checked} multiple={role === "checkbox"} /></button>;
                                      })}
                                    </div>
                                  </section>
                                );
                              })}
                            </div>
                            ) : null}
                            {draft.quantity > 0 && (product.bundleChoiceGroups?.length ?? 0) > 0 ? (
                            <div className="space-y-6">
                              {(product.bundleChoiceGroups ?? []).map((group) => {
                                const groupChoiceIds = new Set(group.options.map((option) => option.id));
                                const selected = draft.bundleChoiceIds;
                                const selectedCount = selected.filter((id) => groupChoiceIds.has(id)).length;
                                const maximumReached = selectedCount >= group.maxSelections;
                                const role = group.maxSelections === 1 ? "radio" : "checkbox";
                                return (
                                  <section key={group.id} aria-labelledby={`qr-configurator-bundle-${group.id}`}>
                                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                                      <h3 id={`qr-configurator-bundle-${group.id}`} className="text-base font-bold"><span className="mr-2 rounded-full bg-teal-700 px-2 py-0.5 text-[11px] text-white">{copy.bundleGroup}</span>{group.name}{group.minSelections > 0 ? " *" : ""}</h3>
                                      <span className="text-xs font-semibold text-stone-500">{group.maxSelections === 1 ? copy.singleChoice : copy.selectionRange(group.minSelections, group.maxSelections)}</span>
                                    </div>
                                    <div className="mt-3 grid gap-2 sm:grid-cols-2" role={role === "radio" ? "radiogroup" : "group"} aria-labelledby={`qr-configurator-bundle-${group.id}`}>
                                      {role === "radio" && group.minSelections === 0 ? <button type="button" data-testid="qr-configurator-option" role="radio" aria-checked={selectedCount === 0} disabled={!orderingEnabled} onClick={() => onSelectBundleChoice(product.id, group, null)} className={`flex min-h-14 items-center justify-between rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold disabled:opacity-40 ${selectedCount === 0 ? "border-teal-700 bg-teal-50 text-teal-950" : "border-stone-300 bg-white text-stone-800"}`}><span>{copy.noSelection}</span><SelectionMark selected={selectedCount === 0} /></button> : null}
                                      {group.options.map((option) => {
                                        const checked = selected.includes(option.id);
                                        return (
                                          <button key={option.id} type="button" data-testid="qr-configurator-option" role={role} aria-checked={checked} disabled={!orderingEnabled || (role === "checkbox" && maximumReached && !checked)} onClick={() => onSelectBundleChoice(product.id, group, option.id)} className={`flex min-h-14 items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left text-sm font-semibold disabled:opacity-40 ${checked ? "border-teal-700 bg-teal-50 text-teal-950" : "border-stone-300 bg-white text-stone-800"}`}>
                                            <span>{bundleChoiceLabel(option)}{option.priceDelta !== 0 ? <span className="ml-2 text-teal-800">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, currency, locale)}</span> : null}</span>
                                            <SelectionMark selected={checked} multiple={role === "checkbox"} />
                                          </button>
                                        );
                                      })}
                                    </div>
                                  </section>
                                );
                              })}
                            </div>
                            ) : null}
                          </div>
                          <footer className="safe-area-bottom sticky bottom-0 shrink-0 border-t border-stone-200 bg-white px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.08)] sm:px-6">
                            {!configurationComplete ? <p role="status" className="mb-3 text-sm font-medium text-amber-800">{copy.requiredNotes(localizedProduct(product).name)}</p> : null}
                            <div className="grid grid-cols-[56px_48px_56px_minmax(0,1fr)] items-center gap-2">
                              <button type="button" aria-label={copy.decrease(localizedProduct(product).name)} disabled={!orderingEnabled || draft.quantity <= 1} onClick={() => onUpdateQuantity(product.id, draft.quantity - 1)} className="grid h-14 w-14 place-items-center rounded-xl border border-stone-300 bg-white disabled:opacity-40"><Minus className="h-5 w-5" /></button>
                              <strong className="text-center text-lg">{draft.quantity}</strong>
                              <button type="button" aria-label={copy.increase(localizedProduct(product).name)} disabled={!orderingEnabled} onClick={() => onUpdateQuantity(product.id, draft.quantity + 1)} className="grid h-14 w-14 place-items-center rounded-xl bg-stone-900 text-white disabled:opacity-40"><Plus className="h-5 w-5" /></button>
                              <button id={`qr-product-action-${product.id}`} type="button" onClick={() => onAddProduct(product)} disabled={!orderingEnabled || !configurationComplete} className="inline-flex min-h-14 min-w-0 items-center justify-center gap-2 rounded-xl bg-teal-800 px-3 text-sm font-bold text-white disabled:opacity-40">
                                <ShoppingCart className="h-5 w-5 shrink-0" />
                                <span className="truncate">
                                  {editingLineIds[product.id] ? copy.finishEditingCartItem : copy.addToCart}
                                </span>
                              </button>
                            </div>
                          </footer>
                        </section>
                      </div>
                    ) : null}
                  </article>
                  </Fragment>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </>
  );
}

function SelectionMark({ selected, multiple = false }: { selected: boolean; multiple?: boolean }) {
  return <span aria-hidden="true" className={`grid h-6 w-6 shrink-0 place-items-center border-2 text-sm font-black ${multiple ? "rounded-md" : "rounded-full"} ${selected ? "border-teal-700 bg-teal-700 text-white" : "border-stone-400 bg-white text-transparent"}`}>✓</span>;
}
