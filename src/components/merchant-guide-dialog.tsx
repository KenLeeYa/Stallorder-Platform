"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowLeft,
  BookOpenCheck,
  CheckCircle2,
  CircleHelp,
  ExternalLink,
  Search,
  TriangleAlert,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  findCurrentMerchantGuideItem,
  getVisibleMerchantGuideItems,
  resolveMerchantGuideHref,
  type MerchantGuideCategory,
  type MerchantGuideItem,
  type MerchantGuideScope,
} from "@/lib/merchant-guide";
import {
  formatMerchantGuideCount,
  formatMerchantGuideText,
  getMerchantGuideCopy,
} from "@/lib/merchant-guide-copy";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

const categoryOrder: readonly MerchantGuideCategory[] = [
  "start",
  "ordering",
  "catalog",
  "operations",
  "reports",
  "people",
  "growth",
  "security",
];

export function MerchantGuideDialog({ scope }: { scope: MerchantGuideScope }) {
  const pathname = usePathname();
  const { locale, label } = useMerchantMessages();
  const copy = getMerchantGuideCopy(locale);
  const items = useMemo(() => getVisibleMerchantGuideItems(scope), [scope]);
  const currentItem = useMemo(
    () => findCurrentMerchantGuideItem(items, scope, pathname),
    [items, pathname, scope],
  );
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<MerchantGuideCategory | "all">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showMobileDetail, setShowMobileDetail] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeButtonRef.current?.focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), [href], input:not(:disabled), [tabindex]:not([tabindex='-1'])",
        ) ?? [],
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
      trigger?.focus();
    };
  }, [open]);

  function itemTitle(item: MerchantGuideItem) {
    return item.messageKey !== undefined
      ? label(item.messageKey)
      : copy.customTitles[item.customTitle];
  }

  const searchableItems = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase(locale);
    return items.filter((item) => {
      if (category !== "all" && item.category !== category) return false;
      if (!normalizedQuery) return true;
      const kind = copy.kinds[item.kind];
      const haystack = [
        itemTitle(item),
        copy.categories[item.category],
        kind.summary,
        ...(item.note ? [copy.notes[item.note]] : []),
      ].join(" ").toLocaleLowerCase(locale);
      return haystack.includes(normalizedQuery);
    });
  // itemTitle is derived from the memoized message dictionary for the active locale.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [category, copy, items, label, locale, query]);

  const selectedItem = searchableItems.find((item) => item.id === selectedId)
    ?? (category === "all" && !query.trim() ? currentItem : null)
    ?? searchableItems[0]
    ?? null;
  const availableCategories = categoryOrder.filter((candidate) => (
    items.some((item) => item.category === candidate)
  ));

  function openGuide() {
    setQuery("");
    setCategory("all");
    setSelectedId(currentItem?.id ?? items[0]?.id ?? null);
    setShowMobileDetail(Boolean(currentItem));
    setOpen(true);
  }

  function selectItem(item: MerchantGuideItem) {
    setSelectedId(item.id);
    setShowMobileDetail(true);
  }

  const detailTitle = selectedItem ? itemTitle(selectedItem) : "";
  const detailCopy = selectedItem ? copy.kinds[selectedItem.kind] : null;

  return (
    <>
      <button
        ref={triggerRef}
        data-testid="merchant-guide-launcher"
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={copy.openGuide}
        title={copy.openGuide}
        onClick={openGuide}
        className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 bg-white text-stone-700 transition-colors hover:border-teal-600 hover:bg-teal-50 hover:text-teal-800"
      >
        <CircleHelp className="h-5 w-5" />
      </button>

      {open && typeof document !== "undefined" ? createPortal(
        <div
          data-testid="merchant-guide-backdrop"
          className="fixed inset-0 z-[110] grid place-items-center overflow-hidden bg-black/65 p-0 sm:p-4"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setOpen(false);
          }}
        >
          <section
            ref={dialogRef}
            data-testid="merchant-guide-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="merchant-guide-title"
            aria-describedby="merchant-guide-subtitle"
            className="flex h-[100dvh] w-full min-w-0 flex-col overflow-hidden bg-white text-stone-950 shadow-2xl sm:h-auto sm:max-h-[min(90dvh,54rem)] sm:max-w-6xl sm:rounded-2xl"
          >
            <header className="flex min-h-16 items-start gap-3 border-b border-stone-200 px-4 py-3 sm:px-5">
              <span className="mt-0.5 hidden h-11 w-11 shrink-0 place-items-center rounded-xl bg-teal-100 text-teal-800 sm:grid">
                <BookOpenCheck className="h-6 w-6" />
              </span>
              <div className="min-w-0 flex-1">
                <h2 id="merchant-guide-title" className="text-lg font-bold sm:text-xl">{copy.title}</h2>
                <p id="merchant-guide-subtitle" className="mt-1 text-sm leading-5 text-stone-600">{copy.subtitle}</p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                aria-label={copy.close}
                title={copy.close}
                onClick={() => setOpen(false)}
                className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 text-stone-700 hover:bg-stone-100"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="border-b border-stone-200 px-4 py-3 sm:px-5">
              <label className="relative block">
                <span className="sr-only">{copy.searchLabel}</span>
                <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-500" />
                <input
                  type="search"
                  maxLength={80}
                  value={query}
                  onChange={(event) => {
                    setQuery(event.target.value);
                    setShowMobileDetail(false);
                  }}
                  placeholder={copy.searchPlaceholder}
                  className="min-h-12 w-full rounded-xl border border-stone-300 bg-white py-3 pl-11 pr-4 text-base outline-none transition focus:border-teal-700 focus:ring-2 focus:ring-teal-200"
                />
              </label>
              <div data-testid="merchant-guide-category-list" className="mt-3 flex gap-2 overflow-x-auto pb-1">
                <button
                  type="button"
                  aria-pressed={category === "all"}
                  onClick={() => {
                    setCategory("all");
                    setShowMobileDetail(false);
                  }}
                  className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${category === "all" ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"}`}
                >
                  {copy.allFunctions}
                </button>
                {currentItem ? (
                  <button
                    type="button"
                    onClick={() => {
                      setCategory("all");
                      setQuery("");
                      selectItem(currentItem);
                    }}
                    className="min-h-11 shrink-0 rounded-full border border-amber-400 bg-amber-50 px-4 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"
                  >
                    {copy.currentPage}
                  </button>
                ) : null}
                {availableCategories.map((candidate) => (
                  <button
                    key={candidate}
                    type="button"
                    aria-pressed={category === candidate}
                    onClick={() => {
                      setCategory(candidate);
                      setShowMobileDetail(false);
                    }}
                    className={`min-h-11 shrink-0 rounded-full border px-4 py-2 text-sm font-semibold ${category === candidate ? "border-teal-700 bg-teal-700 text-white" : "border-stone-300 bg-white text-stone-700 hover:bg-stone-100"}`}
                  >
                    {copy.categories[candidate]}
                  </button>
                ))}
              </div>
            </div>

            {!scope.stall ? (
              <p className="border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm leading-5 text-amber-950 sm:px-5">
                {copy.selectStallHint}
              </p>
            ) : null}

            <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(18rem,0.82fr)_minmax(0,1.18fr)]">
              <aside className={`${showMobileDetail ? "hidden lg:flex" : "flex"} min-h-0 flex-col border-r border-stone-200`}>
                <div className="flex items-center justify-between gap-3 px-4 py-3 text-sm text-stone-600">
                  <span>{formatMerchantGuideCount(copy.count, searchableItems.length)}</span>
                  <span className="text-right text-xs">{copy.roleFiltered}</span>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 sm:px-4">
                  {searchableItems.length ? (
                    <div className="grid gap-2">
                      {searchableItems.map((item) => {
                        const selected = selectedItem?.id === item.id;
                        const isCurrent = currentItem?.id === item.id;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            aria-current={isCurrent ? "page" : undefined}
                            onClick={() => selectItem(item)}
                            className={`flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${selected ? "border-teal-700 bg-teal-50 text-teal-950" : "border-stone-200 bg-white text-stone-800 hover:border-teal-400 hover:bg-teal-50/60"}`}
                          >
                            <span className="min-w-0">
                              <span className="block text-xs font-semibold text-teal-700">{copy.categories[item.category]}</span>
                              <span className="mt-1 block font-semibold leading-5">{itemTitle(item)}</span>
                            </span>
                            {isCurrent ? (
                              <span className="shrink-0 rounded-full bg-amber-100 px-2 py-1 text-xs font-bold text-amber-900">{copy.currentBadge}</span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="rounded-xl border border-dashed border-stone-300 px-4 py-8 text-center text-sm text-stone-600">{copy.noResults}</p>
                  )}
                </div>
              </aside>

              <article className={`${showMobileDetail ? "flex" : "hidden lg:flex"} min-h-0 flex-col`}>
                {selectedItem && detailCopy ? (
                  <>
                    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6">
                      <button
                        type="button"
                        onClick={() => setShowMobileDetail(false)}
                        className="mb-4 inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-semibold text-stone-700 lg:hidden"
                      >
                        <ArrowLeft className="h-4 w-4" />
                        {copy.backToList}
                      </button>
                      <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-teal-700">
                        <span>{copy.categories[selectedItem.category]}</span>
                        {currentItem?.id === selectedItem.id ? (
                          <span className="rounded-full bg-amber-100 px-2 py-1 text-xs text-amber-900">{copy.currentBadge}</span>
                        ) : null}
                      </div>
                      <h3 className="mt-2 text-2xl font-bold tracking-tight sm:text-3xl">{detailTitle}</h3>
                      <p className="mt-3 text-base leading-7 text-stone-700">
                        {formatMerchantGuideText(detailCopy.summary, detailTitle)}
                      </p>

                      <section className="mt-6">
                        <h4 className="text-base font-bold">{copy.operationGuide}</h4>
                        <ol className="mt-3 grid gap-3">
                          {detailCopy.steps.map((step, index) => (
                            <li key={step} className="flex gap-3 rounded-xl bg-stone-100 px-4 py-3 text-sm leading-6 text-stone-800">
                              <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-teal-700 font-bold text-white">{index + 1}</span>
                              <span>{formatMerchantGuideText(step, detailTitle)}</span>
                            </li>
                          ))}
                        </ol>
                      </section>

                      <section className="mt-5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                        <h4 className="flex items-center gap-2 font-bold text-emerald-900">
                          <CheckCircle2 className="h-5 w-5" />
                          {copy.completionStandard}
                        </h4>
                        <p className="mt-2 text-sm leading-6 text-emerald-950">{formatMerchantGuideText(detailCopy.completion, detailTitle)}</p>
                      </section>

                      {selectedItem.note ? (
                        <section className="mt-4 rounded-xl border border-sky-200 bg-sky-50 px-4 py-3 text-sm leading-6 text-sky-950">
                          {copy.notes[selectedItem.note]}
                        </section>
                      ) : null}

                      <section className="mt-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
                        <h4 className="flex items-center gap-2 font-bold text-amber-950">
                          <TriangleAlert className="h-5 w-5" />
                          {copy.attention}
                        </h4>
                        <p className="mt-2 text-sm leading-6 text-amber-950">{formatMerchantGuideText(detailCopy.caution, detailTitle)}</p>
                      </section>
                    </div>
                    <div className="border-t border-stone-200 bg-white px-4 py-3 sm:px-6">
                      <Link
                        href={resolveMerchantGuideHref(selectedItem, scope)}
                        onClick={() => setOpen(false)}
                        className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-teal-700 px-5 py-3 text-base font-bold text-white hover:bg-teal-800 sm:w-auto"
                      >
                        {copy.goToFeature}
                        <ExternalLink className="h-5 w-5" />
                      </Link>
                    </div>
                  </>
                ) : (
                  <p className="m-auto p-8 text-center text-stone-600">{copy.chooseFeature}</p>
                )}
              </article>
            </div>
          </section>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
