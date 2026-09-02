"use client";

import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { QrCodeState, StallOrderingState, UserRole } from "@prisma/client";
import { QRCodeSVG } from "qrcode.react";
import { Ban, BarChart3, CircleStop, Copy, ExternalLink, FileDown, Package, PackageCheck, PackageX, Pause, Play, RotateCw, X } from "lucide-react";
import { StallCatalogSettings, type StallCatalogProduct } from "@/components/stall-catalog-settings";
import { csrfHeaders } from "@/lib/csrf-client";
import { roleLabels } from "@/lib/rbac";

type QrState = { token: string; state: QrCodeState; tokenVersion: number } | null;
type ControlAction = "PAUSE" | "RESUME" | "REVOKE_QR" | "ROTATE_QR" | "MARK_SOLD_OUT" | "MARK_AVAILABLE" | "CLOSE" | "OPEN";

type Props = {
  stall: { id: string; name: string; slug: string; code: string; currency: string; orderingState: StallOrderingState; isSoldOut: boolean };
  products: StallCatalogProduct[];
  sourceStalls: Array<{ id: string; name: string; code: string }>;
  sharedCatalogUrl?: string;
  appBaseUrl: string;
  qrCode: QrState;
  account: { displayName: string; role: UserRole };
};

const qrLabels: Record<QrCodeState, string> = { ACTIVE: "啟用中", PAUSED: "已暫停", EXPIRED: "已到期", REVOKED: "已撤銷" };
const orderingLabels: Record<StallOrderingState, string> = { OPEN: "開放點餐", PAUSED: "暫停點餐", CLOSED: "已關閉點餐" };

export function MerchantProducts({ stall, products, sourceStalls, sharedCatalogUrl, appBaseUrl, qrCode, account }: Props) {
  const { label } = useMerchantMessages();
  const [ordering, setOrdering] = useState({ orderingState: stall.orderingState, isSoldOut: stall.isSoldOut, qrCode });
  const [message, setMessage] = useState("");
  const [menuLinkMessage, setMenuLinkMessage] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false);
  const catalogTriggerRef = useRef<HTMLButtonElement>(null);
  const catalogCloseRef = useRef<HTMLButtonElement>(null);
  const orderUrl = useMemo(() => ordering.qrCode ? `${appBaseUrl.replace(/\/$/, "")}/q/${ordering.qrCode.token}` : "", [appBaseUrl, ordering.qrCode]);
  const publicStorefrontPath = `/store/${encodeURIComponent(stall.code.trim().toLowerCase())}`;

  useEffect(() => {
    if (!catalogDialogOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const focusTimer = window.setTimeout(() => catalogCloseRef.current?.focus(), 0);
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setCatalogDialogOpen(false);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      window.clearTimeout(focusTimer);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [catalogDialogOpen]);

  function closeCatalogDialog() {
    setCatalogDialogOpen(false);
    window.requestAnimationFrame(() => catalogTriggerRef.current?.focus());
  }

  async function requestOrderingUpdate(body: Record<string, unknown>) {
    setMessage("");
    setIsSaving(true);
    try {
      const response = await fetch(`/api/stalls/${stall.slug}/ordering`, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify(body) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? label("目前無法更新點餐設定。"));
      setOrdering({ orderingState: payload.state.orderingState, isSoldOut: payload.state.isSoldOut, qrCode: payload.state.qrCode });
      setMessage(label("點餐設定已更新。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("網路連線中斷，請稍後再試。"));
    } finally {
      setIsSaving(false);
    }
  }

  async function runControl(action: ControlAction) {
    if ((action === "REVOKE_QR" || action === "ROTATE_QR") && !window.confirm(action === "REVOKE_QR" ? label("確定撤銷目前的 QR Code？撤銷後無法恢復。") : label("確定輪替 QR token？現有印刷 QR Code 將立即失效。"))) return;
    await requestOrderingUpdate({ action });
  }

  async function copyPublicStorefrontUrl() {
    setMenuLinkMessage("");
    const publicMenuUrl = new URL(publicStorefrontPath, window.location.origin).toString();
    try {
      await navigator.clipboard.writeText(publicMenuUrl);
      setMenuLinkMessage(label("統一公開連結已複製。"));
    } catch {
      window.prompt(label("請複製統一公開連結"), publicMenuUrl);
      setMenuLinkMessage(label("請在提示視窗中複製公開菜單連結。"));
    }
  }

  return (
    <main className="mx-auto grid min-h-[calc(100dvh-76px)] max-w-7xl gap-6 px-4 py-5 md:px-8 xl:h-[calc(100dvh-76px)] xl:min-h-0 xl:grid-cols-[340px_minmax(0,1fr)] xl:overflow-hidden">
      <aside className="h-fit min-h-0 xl:h-full xl:overflow-y-auto xl:overscroll-contain xl:pr-3">
        <div><p className="text-sm font-medium text-teal-800">{label("攤位管理")}</p><p className="mt-1 text-xs text-stone-500">{account.displayName} · {label(roleLabels[account.role])}</p></div>
        <h1 className="mt-2 text-3xl font-semibold">{stall.name}</h1>

        <div className="mt-5 flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-md bg-teal-50 px-2 py-1 text-teal-800">{label(orderingLabels[ordering.orderingState])}</span>
          <span className={`rounded-md px-2 py-1 ${ordering.isSoldOut ? "bg-red-50 text-red-800" : "bg-stone-100 text-stone-700"}`}>{ordering.isSoldOut ? label("全攤售完") : label("可供應")}</span>
          {ordering.qrCode ? <span className="rounded-md bg-stone-100 px-2 py-1 text-stone-700">QR {label(qrLabels[ordering.qrCode.state])}</span> : null}
        </div>

        <button
          ref={catalogTriggerRef}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setCatalogDialogOpen(true)}
          className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white xl:hidden"
        >
          <Package className="h-5 w-5" />
          {label("攤位商品設定")}
        </button>

        {orderUrl ? (
          <div data-testid="merchant-ordering-qr" className="mx-auto mt-5 w-full max-w-sm xl:mx-0">
            <div className="rounded-lg border border-stone-200 bg-white p-4"><QRCodeSVG data-testid="merchant-ordering-qr-code" value={orderUrl} size={240} className="h-auto w-full" /></div>
            <p className="mt-3 text-sm font-medium">{label("顧客點餐 QR Code · v")}{ordering.qrCode?.tokenVersion}</p>
            <p className="mt-1 break-all text-xs text-stone-500">{orderUrl}</p>
            <div className="mt-3 grid grid-cols-3 gap-2">
              <Link href={`/merchant/stalls/${stall.id}/qr-print?target=stall&paper=A4`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-teal-300 bg-white px-3 text-sm font-semibold text-teal-900"><FileDown className="h-4 w-4" />{label("A4 印刷版")}</Link>
              <Link href={`/merchant/stalls/${stall.id}/qr-print?target=stall&paper=A5`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white"><FileDown className="h-4 w-4" />{label("A5 印刷版")}</Link>
              <Link href={`/merchant/stalls/${stall.id}/qr-print?target=stall&paper=A6`} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-teal-300 bg-white px-3 text-sm font-semibold text-teal-900"><FileDown className="h-4 w-4" />{label("A6 印刷版")}</Link>
            </div>
          </div>
        ) : <p className="mt-5 text-sm text-red-700">{label("目前沒有可用的 QR Code，請執行輪替以建立新 QR。")}</p>}

        <section aria-labelledby="public-menu-link-title" className="mt-5 rounded-lg border border-teal-200 bg-teal-50 p-4">
          <h2 id="public-menu-link-title" className="font-semibold text-teal-950">{label("統一公開連結")}</h2>
          <p className="mt-1 text-xs leading-5 text-teal-900">{label("可貼到 LINE、Google 商家或社群平台；顧客可在同一頁查看線上 Menu、選擇外帶自取或外送。")}</p>
          <p className="mt-3 break-all rounded-md bg-white px-3 py-2 text-xs text-stone-600">{label("永久路徑：")}{publicStorefrontPath}</p>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <a href={publicStorefrontPath} target="_blank" rel="noreferrer" className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md border border-teal-300 bg-white px-3 text-sm font-semibold text-teal-900"><ExternalLink className="h-4 w-4" />{label("開啟公開頁")}</a>
            <button type="button" onClick={() => void copyPublicStorefrontUrl()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-md bg-teal-800 px-3 text-sm font-semibold text-white"><Copy className="h-4 w-4" />{label("複製連結")}</button>
          </div>
          {menuLinkMessage ? <p role="status" className="mt-2 text-xs font-medium text-teal-900">{menuLinkMessage}</p> : null}
        </section>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {ordering.orderingState === "PAUSED" ? (
            <button type="button" disabled={isSaving} onClick={() => void runControl("RESUME")} className="inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold"><Play className="h-4 w-4" />{label("恢復")}</button>
          ) : (
            <button type="button" disabled={isSaving} onClick={() => void runControl("PAUSE")} className="inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold"><Pause className="h-4 w-4" />{label("暫停")}</button>
          )}
          {ordering.orderingState === "CLOSED" ? (
            <button type="button" disabled={isSaving} onClick={() => void runControl("OPEN")} className="inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold"><Play className="h-4 w-4" />{label("開放")}</button>
          ) : (
            <button type="button" disabled={isSaving} onClick={() => void runControl("CLOSE")} className="inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold"><CircleStop className="h-4 w-4" />{label("關閉")}</button>
          )}
          <button type="button" disabled={isSaving} onClick={() => void runControl(ordering.isSoldOut ? "MARK_AVAILABLE" : "MARK_SOLD_OUT")} className="inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold">
            {ordering.isSoldOut ? <PackageCheck className="h-4 w-4" /> : <PackageX className="h-4 w-4" />}{ordering.isSoldOut ? label("恢復供應") : label("全攤售完")}
          </button>
          <button type="button" disabled={isSaving} onClick={() => void runControl("ROTATE_QR")} className="inline-flex items-center justify-center gap-2 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold"><RotateCw className="h-4 w-4" />{label("輪替 QR")}</button>
          <button type="button" disabled={isSaving || !ordering.qrCode || ordering.qrCode.state === "REVOKED"} onClick={() => void runControl("REVOKE_QR")} className="col-span-2 inline-flex items-center justify-center gap-2 rounded-md border border-red-300 px-3 py-2 text-sm font-semibold text-red-800 disabled:opacity-40"><Ban className="h-4 w-4" />{label("撤銷目前 QR")}</button>
        </div>
        <Link href={`/merchant/${stall.slug}/reports`} className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-teal-800"><BarChart3 className="h-4 w-4" />{label("查看每日報表")}</Link>
        {sharedCatalogUrl ? <Link href={sharedCatalogUrl} className="mt-3 flex items-center gap-2 text-sm font-semibold text-teal-800"><Package className="h-4 w-4" />{label("管理共用商品主檔")}</Link> : null}
      </aside>

      <div className={`${catalogDialogOpen ? "fixed inset-0 z-50 flex items-stretch bg-black/50 p-3 sm:p-6" : "hidden"} min-h-0 xl:static xl:z-auto xl:block xl:h-full xl:bg-transparent xl:p-0`}>
        <section
          role={catalogDialogOpen ? "dialog" : undefined}
          aria-modal={catalogDialogOpen ? true : undefined}
          aria-labelledby={catalogDialogOpen ? "stall-product-dialog-title" : undefined}
          className="flex max-h-full w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl xl:h-full xl:max-h-none xl:rounded-none xl:bg-transparent xl:shadow-none"
        >
          <div className="flex items-center justify-between gap-3 border-b border-stone-200 px-4 py-3 xl:hidden">
            <h2 id="stall-product-dialog-title" className="text-lg font-semibold">{label("攤位商品設定")}</h2>
            <button ref={catalogCloseRef} type="button" title={label("關閉")} aria-label={label("關閉")} onClick={closeCatalogDialog} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4 xl:h-full xl:p-0 xl:pl-1 xl:pr-3">
            {message ? <p role="alert" className="mb-4 text-sm text-red-700">{message}</p> : null}
            <StallCatalogSettings stallId={stall.id} currency={stall.currency} initialProducts={products} sourceStalls={sourceStalls} />
          </div>
        </section>
      </div>
    </main>
  );
}
