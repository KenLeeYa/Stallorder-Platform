"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ExternalLink, Languages, Search } from "lucide-react";
import { LocaleFlag } from "@/components/locale-flag";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { QR_LOCALES, qrOrderMessages, type QrLocale } from "@/lib/qr-order-i18n";
import type { TranslationCoverage, TranslationEntityType } from "@/lib/translation-completeness";

const entityLabels: Record<TranslationEntityType, string> = {
  PRODUCT: "商品名稱",
  PRODUCT_DESCRIPTION: "商品說明",
  NOTE_GROUP: "註記群組",
  NOTE_OPTION: "註記選項",
};

export function LocalizationDashboard({
  organizationId,
  coverage,
  stalls,
  returnStallId,
}: {
  organizationId: string;
  coverage: TranslationCoverage[];
  stalls: Array<{ id: string; name: string; enabledLocales: string[] }>;
  returnStallId?: string;
}) {
  const [locale, setLocale] = useState<QrLocale>("en");
  const [entityType, setEntityType] = useState<TranslationEntityType | "ALL">("ALL");
  const [query, setQuery] = useState("");
  const [stallId, setStallId] = useState(stalls[0]?.id ?? "");
  const current = coverage.find((item) => item.locale === locale) ?? coverage[0];
  const missing = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("zh-TW");
    return (current?.missing ?? []).filter((item) => (
      (entityType === "ALL" || item.entityType === entityType)
      && (!normalized || item.sourceName.toLocaleLowerCase("zh-TW").includes(normalized))
    ));
  }, [current, entityType, query]);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-7 md:px-8">
      {returnStallId ? (
        <div className="mb-4">
          <StallSettingsBackLink stallId={returnStallId} />
        </div>
      ) : null}
      <div className="border-b border-stone-200 pb-5">
        <div className="flex items-center gap-2 text-teal-800"><Languages className="h-5 w-5" /><span className="text-sm font-semibold">多語系品質</span></div>
        <h1 className="mt-2 text-3xl font-semibold">翻譯完整度</h1>
        <p className="mt-2 text-sm text-stone-600">依啟用中的商品、註記群組及選項檢查；繁體中文為來源語系。</p>
      </div>

      <section className="border-b border-stone-200 py-6" aria-labelledby="coverage-title">
        <h2 id="coverage-title" className="text-lg font-semibold">各語系覆蓋率</h2>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {coverage.map((item) => (
            <button key={item.locale} type="button" onClick={() => setLocale(item.locale)} aria-pressed={locale === item.locale} className={`rounded-md border p-4 text-left ${locale === item.locale ? "border-teal-600 bg-teal-50" : "border-stone-200 bg-white"}`}>
              <div className="flex items-center justify-between gap-3"><span className="inline-flex min-w-0 items-center gap-2 font-semibold"><LocaleFlag locale={item.locale} /><span className="truncate">{qrOrderMessages[item.locale].localeName}</span></span><span className={`text-lg font-semibold ${item.percentage === 100 ? "text-emerald-700" : "text-amber-800"}`}>{item.percentage}%</span></div>
              <div className="mt-3 h-2 overflow-hidden rounded bg-stone-200"><span className="block h-full bg-teal-700" style={{ width: `${item.percentage}%` }} /></div>
              <p className="mt-2 text-xs text-stone-500">完成 {item.completed} / {item.total}，缺漏 {item.missing.length}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="grid gap-6 border-b border-stone-200 py-6 lg:grid-cols-[minmax(0,1.3fr)_minmax(280px,0.7fr)]">
        <div>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div><h2 className="text-lg font-semibold">缺漏項目</h2><p className="mt-1 inline-flex items-center gap-2 text-sm text-stone-500"><LocaleFlag locale={locale} />{qrOrderMessages[locale].localeName} · {missing.length} 項</p></div>
            <Link href={`/merchant/catalog?organizationId=${organizationId}`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold text-teal-800">前往編輯翻譯<ExternalLink className="h-4 w-4" /></Link>
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_180px]">
            <label className="relative"><span className="sr-only">搜尋缺漏項目</span><Search className="pointer-events-none absolute left-3 top-3.5 h-4 w-4 text-stone-400" /><input type="search" value={query} maxLength={120} onChange={(event) => setQuery(event.target.value)} placeholder="搜尋原文名稱" className="h-11 w-full rounded-md border border-stone-300 bg-white pl-9 pr-3 text-sm" /></label>
            <select aria-label="缺漏類型" value={entityType} onChange={(event) => setEntityType(event.target.value as TranslationEntityType | "ALL")} className="h-10 rounded-md border border-stone-300 bg-white px-3 text-sm"><option value="ALL">全部類型</option>{Object.entries(entityLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
          </div>
          <div className="mt-4 divide-y divide-stone-100 border-y border-stone-200">
            {missing.map((item) => <div key={`${item.entityType}-${item.entityId}`} className="flex items-center justify-between gap-3 py-3"><span className="min-w-0 truncate text-sm font-medium">{item.sourceName}</span><span className="shrink-0 text-xs text-stone-500">{entityLabels[item.entityType]}</span></div>)}
            {missing.length === 0 ? <p className="py-8 text-center text-sm text-emerald-700">此篩選範圍沒有翻譯缺漏。</p> : null}
          </div>
        </div>

        <aside className="border-l-0 border-stone-200 lg:border-l lg:pl-6" aria-labelledby="preview-title">
          <h2 id="preview-title" className="text-lg font-semibold">QR 語系預覽</h2>
          <p className="mt-1 text-sm text-stone-500">預覽不會建立點餐 Session，也不能送出訂單。</p>
          <label className="mt-4 block text-sm font-medium">預覽攤位<select value={stallId} onChange={(event) => setStallId(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3">{stalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}</select></label>
          <div className="mt-4 grid grid-cols-2 gap-2">
            {QR_LOCALES.map((previewLocale) => {
              const selectedStall = stalls.find((stall) => stall.id === stallId);
              const enabled = previewLocale === "zh-TW" || selectedStall?.enabledLocales.includes(previewLocale);
              return <Link key={previewLocale} target="_blank" rel="noopener noreferrer" href={`/merchant/localization/preview?organizationId=${organizationId}&stallId=${stallId}&locale=${previewLocale}`} className={`inline-flex min-h-11 items-center justify-between gap-2 rounded-md border px-3 text-sm font-semibold ${enabled ? "border-stone-300 bg-white text-stone-900" : "border-stone-200 bg-stone-100 text-stone-500"}`}><span className="inline-flex min-w-0 items-center gap-2"><LocaleFlag locale={previewLocale} /><span className="truncate">{qrOrderMessages[previewLocale].localeName}</span></span><ExternalLink className="h-3.5 w-3.5 shrink-0" /></Link>;
            })}
          </div>
        </aside>
      </section>
    </main>
  );
}
