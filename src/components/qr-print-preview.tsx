"use client";

import Image from "next/image";
import Link from "next/link";
import { ArrowLeft, FileDown, Printer } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { paginateQrPrintItems, type QrPrintPaper, type QrPrintTarget } from "@/lib/qr-print-layout";

export type QrPrintItem = {
  id: string;
  label: string;
  code?: string | null;
  url: string;
};

export function QrPrintPreview({
  stallId,
  stallName,
  target,
  paper,
  items,
  backHref,
}: {
  stallId: string;
  stallName: string;
  target: QrPrintTarget;
  paper: QrPrintPaper;
  items: QrPrintItem[];
  backHref: string;
}) {
  const { label, m } = useMerchantMessages();
  const pages = paginateQrPrintItems(items, target);
  const single = target !== "tables";
  const sheetWidth = paper === "A6" ? 89 : paper === "A5" ? 132 : 194;
  const sheetHeight = paper === "A6" ? 132 : paper === "A5" ? 194 : 281;
  const singleTargetQuery = target === "table" && items[0]
    ? `target=table&tableId=${encodeURIComponent(items[0].id)}`
    : "target=stall";

  return (
    <main className="qr-print-shell min-h-screen bg-stone-100 px-3 py-5 text-stone-950 sm:px-6">
      <style>{`
        @page { size: ${paper} portrait; margin: 8mm; }
        .qr-print-sheet { width: ${sheetWidth}mm; min-height: ${sheetHeight}mm; }
        :root[data-theme="dark"] .qr-print-sheet,
        :root[data-theme="dark"] .qr-print-card { background: #fff !important; color: #0c0a09 !important; }
        :root[data-theme="dark"] .qr-print-card { border-color: #115e59 !important; }
        :root[data-theme="dark"] .qr-print-brand { color: #134e4a !important; }
        :root[data-theme="dark"] .qr-print-label { color: #0c0a09 !important; }
        :root[data-theme="dark"] .qr-print-accent { color: #0f766e !important; }
        :root[data-theme="dark"] .qr-print-cta { background: #115e59 !important; color: #fff !important; }
        :root[data-theme="dark"] .qr-print-note { color: #78716c !important; }
        :root[data-theme="dark"] .qr-print-stripe { background: linear-gradient(to right, #fbbf24, #0f766e, #10b981) !important; }
        @media print {
          .skip-link, .qr-print-controls { display: none !important; }
          .qr-print-shell { max-width: none !important; min-height: 0 !important; padding: 0 !important; background: #fff !important; }
          .qr-print-sheet { margin: 0 !important; box-shadow: none !important; break-after: page; page-break-after: always; }
          .qr-print-sheet:last-child { break-after: auto; page-break-after: auto; }
          .qr-print-card { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
        }
      `}</style>

      <header className="qr-print-controls mx-auto mb-5 flex max-w-5xl flex-wrap items-center justify-between gap-3 rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex min-w-0 items-center gap-3">
          <Link href={backHref} aria-label={label("返回")} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"><ArrowLeft className="h-5 w-5" /></Link>
          <div className="min-w-0"><p className="truncate text-sm font-semibold text-teal-800">{stallName}</p><h1 className="text-xl font-bold">{label("QR 印刷版預覽")}</h1><p className="mt-1 text-xs text-stone-500">{target === "tables" ? label("A4 每頁最多 6 張，保留裁切間距。") : paper === "A6" ? label("A6 直式版面，可列印或另存 PDF。") : paper === "A5" ? label("A5 直式版面，可列印或另存 PDF。") : label("A4 直式版面，可列印或另存 PDF。")}</p></div>
        </div>
        <div className="flex flex-wrap gap-2">
          {single ? <>
            <Link href={`/merchant/stalls/${stallId}/qr-print?${singleTargetQuery}&paper=A4`} aria-current={paper === "A4" ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${paper === "A4" ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white"}`}><FileDown className="h-4 w-4" />A4</Link>
            <Link href={`/merchant/stalls/${stallId}/qr-print?${singleTargetQuery}&paper=A5`} aria-current={paper === "A5" ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${paper === "A5" ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white"}`}><FileDown className="h-4 w-4" />A5</Link>
            <Link href={`/merchant/stalls/${stallId}/qr-print?${singleTargetQuery}&paper=A6`} aria-current={paper === "A6" ? "page" : undefined} className={`inline-flex min-h-11 items-center gap-2 rounded-md border px-3 text-sm font-semibold ${paper === "A6" ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white"}`}><FileDown className="h-4 w-4" />A6</Link>
          </> : null}
          <button type="button" disabled={pages.length === 0} onClick={() => window.print()} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40"><Printer className="h-4 w-4" />{label("列印／存成 PDF")}</button>
        </div>
      </header>

      {pages.length === 0 ? <p role="alert" className="qr-print-controls mx-auto max-w-xl rounded-lg border border-amber-300 bg-amber-50 p-5 text-sm font-semibold text-amber-900">{label("目前沒有可列印的有效 QR，請先建立或啟用 QR。")}</p> : null}

      <div className="grid justify-center gap-6 overflow-x-auto pb-8">
        {pages.map((page, pageIndex) => (
          <section key={`${target}-${pageIndex}`} aria-label={m("QR 印刷第 {value0} 頁", { value0: pageIndex + 1 })} className={`qr-print-sheet bg-white p-[8mm] shadow-xl ${single ? "flex items-stretch" : "grid grid-cols-2 grid-rows-3 gap-[6mm]"}`}>
            {page.map((item) => (
              <QrPrintCard key={item.id} item={item} stallName={stallName} compact={!single} paper={paper} />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}

function QrPrintCard({
  item,
  stallName,
  compact,
  paper,
}: {
  item: QrPrintItem;
  stallName: string;
  compact: boolean;
  paper: QrPrintPaper;
}) {
  const { label } = useMerchantMessages();
  const singleCardClass = paper === "A4"
    ? "justify-center p-[12mm]"
    : paper === "A5"
      ? "justify-center p-[9mm]"
      : "justify-center p-[5mm]";
  const brandClass = compact
    ? "mt-[1mm] text-[12px]"
    : paper === "A4"
      ? "text-[32px]"
      : paper === "A5"
        ? "text-[22px]"
        : "text-[16px]";
  const logoSize = compact ? 28 : paper === "A4" ? 72 : paper === "A5" ? 48 : 32;
  const titleClass = compact
    ? "max-w-[72mm] truncate text-[13px]"
    : paper === "A4"
      ? "text-[40px]"
      : paper === "A5"
        ? "text-[26px]"
        : "text-[18px]";
  const qrClass = compact
    ? "h-[38mm] w-[38mm]"
    : paper === "A4"
      ? "h-[115mm] w-[115mm]"
      : paper === "A5"
        ? "h-[72mm] w-[72mm]"
        : "h-[48mm] w-[48mm]";
  const ctaClass = compact
    ? "px-2 py-2 text-[11px]"
    : paper === "A4"
      ? "px-7 py-5 text-[30px]"
      : paper === "A5"
        ? "px-5 py-4 text-[20px]"
        : "px-3 py-2.5 text-[14px]";
  const noteClass = compact
    ? "mt-1 text-[8px]"
    : paper === "A4"
      ? "mt-6 text-[18px]"
      : paper === "A5"
        ? "mt-4 text-[12px]"
        : "mt-2 text-[10px]";

  return (
    <article className={`qr-print-card relative flex w-full flex-col items-center overflow-hidden rounded-[5mm] border-[0.7mm] border-teal-800 bg-white text-center ${compact ? "justify-between border-dashed p-[4mm]" : singleCardClass}`}>
      <span className="qr-print-stripe absolute inset-x-0 top-0 h-[3mm] bg-gradient-to-r from-amber-400 via-teal-700 to-emerald-500" aria-hidden="true" />
      <div className={`qr-print-brand flex items-center justify-center gap-2 font-bold text-teal-900 ${brandClass}`}>
        <Image src="/icons/stallorder-192.png" alt="" width={logoSize} height={logoSize} className="shrink-0" />
        <span>{label("攤點通")}</span>
      </div>
      <div className={compact ? "mt-[1mm]" : paper === "A6" ? "mt-[3mm]" : "mt-[8mm]"}>
        <p className={`qr-print-label font-bold text-stone-950 ${titleClass}`}>{stallName}</p>
        {item.code ? <p className={`qr-print-accent mt-1 font-semibold text-teal-800 ${compact ? "text-[11px]" : "text-[18px]"}`}>{item.label}</p> : null}
      </div>
      <div className={`bg-white ${compact ? "my-[1mm]" : paper === "A6" ? "my-[3mm]" : "my-[8mm]"}`}>
        <QRCodeSVG value={item.url} level="M" includeMargin size={compact ? 148 : paper === "A4" ? 460 : paper === "A5" ? 290 : 192} className={qrClass} />
      </div>
      <div className={`qr-print-cta w-full rounded-full bg-teal-800 font-bold tracking-wide text-white ${ctaClass}`}>{label("手機掃碼點餐")}</div>
      <p className={`qr-print-note font-medium text-stone-500 ${noteClass}`}>{label("開啟手機相機・免下載 App")}</p>
    </article>
  );
}
