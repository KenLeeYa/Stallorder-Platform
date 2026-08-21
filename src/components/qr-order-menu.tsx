import { Fragment, type RefObject } from "react";
import { Flame, Minus, Plus, X } from "lucide-react";
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
        <nav aria-label={copy.categoryNavigation} className="sticky top-0 z-20 -mx-4 mt-5 flex gap-2 overflow-x-auto border-y border-stone-200 bg-stone-50/95 px-4 py-2 backdrop-blur md:static md:mx-0 md:border-x-0 md:bg-transparent md:px-0">
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
          <section key={category} id={`qr-category-${categoryIndex}`} className="scroll-mt-16">
            <h2 className="mb-2 text-sm font-semibold text-stone-500 sm:mb-3">{localizedCategory(category)}</h2>
            <div className="grid gap-2 sm:gap-3">
              {visibleProducts.filter((product) => product.category === category).map((product, productIndex, categoryProducts) => {
                const configurable = product.noteGroups.length > 0 || product.bundleChoiceGroups.length > 0;
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
                  {showGroupHeading ? <p data-testid="qr-product-group-heading" className="col-span-full mt-2 text-xs font-bold uppercase tracking-wide text-teal-800 first:mt-0">{product.group}</p> : null}
                  <article
                    id={`qr-product-${product.id}`}
                    data-best-seller-rank={product.rank ?? undefined}
                    tabIndex={-1}
                    className="rounded-lg border border-stone-200 bg-white p-3 sm:p-4"
                  >
                    <div className="grid grid-cols-[56px_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[80px_minmax(0,1fr)_auto] sm:gap-4">
                      {product.imageUrl ? <ProductImage src={product.imageUrl} alt={copy.productImage(localizedProduct(product).name)} width={80} height={80} sizes="(max-width: 639px) 56px, 80px" className="h-14 w-14 shrink-0 rounded-md object-cover sm:h-20 sm:w-20" /> : <div aria-hidden="true" className="h-14 w-14 rounded-md bg-stone-100 sm:h-20 sm:w-20" />}
                      <div className="min-w-0 flex-1">
                        {product.isBestSeller ? <span data-testid="best-seller-badge" className="mb-1 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-950"><Flame aria-hidden="true" className="h-3.5 w-3.5" />{copy.hotSellerBadge}</span> : null}
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
                        {configurable && committedQuantity > 0 ? <span className="mr-1 text-xs font-medium text-stone-500">{copy.additionalQuantity}</span> : null}
                        <button type="button" title={copy.decrease(localizedProduct(product).name)} aria-label={copy.decrease(localizedProduct(product).name)} disabled={!orderingEnabled || configuringProductId === product.id || displayedQuantity <= 0} onClick={() => onUpdateQuantity(product.id, displayedQuantity - 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 disabled:opacity-40">
                          <Minus className="h-4 w-4" />
                        </button>
                        <span className="w-8 text-center font-semibold">{displayedQuantity}</span>
                        <button type="button" title={copy.increase(localizedProduct(product).name)} aria-label={copy.increase(localizedProduct(product).name)} disabled={!orderingEnabled || configuringProductId === product.id} onClick={() => onUpdateQuantity(product.id, displayedQuantity + 1)} className="grid h-11 w-11 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-40">
                          <Plus className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    {configurable && configuringProductId === product.id && !sessionExpiryDialogOpen && draft.quantity > 0 ? (
                      <>
                        <button type="button" aria-label={copy.close} onClick={() => onCancelConfiguration(product.id)} className="fixed inset-0 z-40 bg-black/50" />
                        <section
                          ref={configurationRef}
                          role="dialog"
                          aria-modal="true"
                          aria-labelledby={`qr-product-configuration-${product.id}`}
                          tabIndex={-1}
                          data-testid="qr-product-configuration"
                          className="safe-area-bottom fixed inset-x-0 bottom-0 z-50 max-h-[88dvh] overflow-y-auto rounded-t-xl bg-white p-5 text-stone-900 shadow-2xl outline-none sm:left-1/2 sm:max-w-lg sm:-translate-x-1/2 sm:rounded-xl"
                        >
                          <div className="flex items-start justify-between gap-3 border-b border-stone-200 pb-4">
                            <div className="min-w-0">
                              <p className="text-xs font-semibold text-teal-800">{editingLineIds[product.id] ? copy.editCartItem : copy.addToCart}</p>
                              <h2 id={`qr-product-configuration-${product.id}`} className="mt-1 text-xl font-semibold">{localizedProduct(product).name}</h2>
                            </div>
                            <button type="button" title={copy.close} aria-label={copy.close} onClick={() => onCancelConfiguration(product.id)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300">
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="mt-4 flex items-center justify-between gap-3 rounded-md bg-stone-50 p-3">
                            <span className="text-sm font-semibold">{copy.itemCount(draft.quantity)}</span>
                            <div className="grid grid-cols-[44px_32px_44px] items-center gap-2">
                              <button type="button" aria-label={copy.decrease(localizedProduct(product).name)} disabled={!orderingEnabled || draft.quantity <= 1} onClick={() => onUpdateQuantity(product.id, draft.quantity - 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button>
                              <span className="text-center font-semibold">{draft.quantity}</span>
                              <button type="button" aria-label={copy.increase(localizedProduct(product).name)} disabled={!orderingEnabled} onClick={() => onUpdateQuantity(product.id, draft.quantity + 1)} className="grid h-11 w-11 place-items-center rounded-md bg-teal-700 text-white disabled:opacity-40"><Plus className="h-4 w-4" /></button>
                            </div>
                          </div>
                          {draft.quantity > 0 && product.noteGroups.length > 0 ? (
                            <div className="mt-4 space-y-4 border-t border-stone-200 pt-4">
                              {product.noteGroups.map((group) => {
                                const groupOptionIds = new Set(group.options.map((option) => option.id));
                                const selectedCount = draft.noteOptionIds.filter((id) => groupOptionIds.has(id)).length;
                                const maximumReached = group.maxSelections !== null && selectedCount >= group.maxSelections;
                                return (
                                  <fieldset key={group.id}>
                                    <legend className="text-sm font-semibold text-stone-700">{localizedGroupName(group)}{group.isRequired ? " *" : ""}<span className="ml-2 text-xs font-normal text-stone-500">{group.selectionMode === "SINGLE" ? copy.singleChoice : group.maxSelections ? copy.maxSelections(group.maxSelections) : copy.multipleChoice}</span></legend>
                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                                      {group.selectionMode === "SINGLE" && !group.isRequired ? <label className="inline-flex min-h-9 items-center gap-2 text-sm"><input type="radio" name={`note-${product.id}-${group.id}`} checked={selectedCount === 0} disabled={!orderingEnabled} onChange={() => onSelectNoteOption(product.id, group, null)} />{copy.noSelection}</label> : null}
                                      {group.options.map((option) => {
                                        const checked = draft.noteOptionIds.includes(option.id);
                                        return <label key={option.id} className="inline-flex min-h-9 items-center gap-2 text-sm"><input type={group.selectionMode === "SINGLE" ? "radio" : "checkbox"} name={`note-${product.id}-${group.id}`} checked={checked} disabled={!orderingEnabled || (group.selectionMode === "MULTIPLE" && maximumReached && !checked)} onChange={() => onSelectNoteOption(product.id, group, option.id)} /><span>{localizedOptionName(option)}</span>{option.priceDelta !== 0 ? <span className="text-xs text-stone-500">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, currency, locale)}</span> : null}</label>;
                                      })}
                                    </div>
                                  </fieldset>
                                );
                              })}
                            </div>
                          ) : null}
                          {draft.quantity > 0 && (product.bundleChoiceGroups?.length ?? 0) > 0 ? (
                            <div className="mt-4 space-y-4 border-t border-stone-200 pt-4">
                              {(product.bundleChoiceGroups ?? []).map((group) => {
                                const groupChoiceIds = new Set(group.options.map((option) => option.id));
                                const selected = draft.bundleChoiceIds;
                                const selectedCount = selected.filter((id) => groupChoiceIds.has(id)).length;
                                const maximumReached = selectedCount >= group.maxSelections;
                                return (
                                  <fieldset key={group.id} className="rounded-md border border-teal-200 bg-teal-50/60 p-3">
                                    <legend className="px-2 text-sm font-bold text-teal-950">
                                      <span className="mr-2 rounded-full bg-teal-700 px-2 py-0.5 text-[11px] text-white">{copy.bundleGroup}</span>
                                      {group.name}{group.minSelections > 0 ? " *" : ""}
                                      <span className="ml-2 text-xs font-normal text-teal-800">
                                        {group.maxSelections === 1
                                          ? copy.singleChoice
                                          : copy.selectionRange(group.minSelections, group.maxSelections)}
                                      </span>
                                    </legend>
                                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">
                                      {group.maxSelections === 1 && group.minSelections === 0 ? (
                                        <label className="inline-flex min-h-9 items-center gap-2 text-sm">
                                          <input
                                            type="radio"
                                            name={`bundle-${product.id}-${group.id}`}
                                            checked={selectedCount === 0}
                                            disabled={!orderingEnabled}
                                            onChange={() => onSelectBundleChoice(product.id, group, null)}
                                          />
                                          {copy.noSelection}
                                        </label>
                                      ) : null}
                                      {group.options.map((option) => {
                                        const checked = selected.includes(option.id);
                                        return (
                                          <label key={option.id} className="inline-flex min-h-9 items-center gap-2 text-sm">
                                            <input
                                              type={group.maxSelections === 1 ? "radio" : "checkbox"}
                                              name={`bundle-${product.id}-${group.id}`}
                                              checked={checked}
                                              disabled={!orderingEnabled || (group.maxSelections > 1 && maximumReached && !checked)}
                                              onChange={() => onSelectBundleChoice(product.id, group, option.id)}
                                            />
                                            <span>{bundleChoiceLabel(option)}</span>
                                            {option.priceDelta !== 0 ? (
                                              <span className="text-xs text-stone-500">
                                                {option.priceDelta > 0 ? "+" : ""}
                                                {formatMoney(option.priceDelta, currency, locale)}
                                              </span>
                                            ) : null}
                                          </label>
                                        );
                                      })}
                                    </div>
                                  </fieldset>
                                );
                              })}
                            </div>
                          ) : null}
                          {configurable && draft.quantity > 0 ? (
                            <button id={`qr-product-action-${product.id}`} type="button" onClick={() => onAddProduct(product)} disabled={!orderingEnabled || !configurationComplete} className="mt-4 min-h-11 w-full scroll-mb-24 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-40">
                              {editingLineIds[product.id] ? copy.finishEditingCartItem : copy.addToCart}
                            </button>
                          ) : null}
                          {!configurationComplete ? <p role="status" className="mt-3 text-sm font-medium text-amber-800">{copy.requiredNotes(localizedProduct(product).name)}</p> : null}
                        </section>
                      </>
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
