"use client";
import { useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";

export function LinePlatformPickupCard({ orderId }: { orderId: string }) {
  const [media, setMedia] = useState<{ imageUrl: string; expiresAt: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function show() {
    setBusy(true); setMessage(""); setMedia(null);
    try {
      const response = await fetch(`/api/line-platform/pickup/customer/${encodeURIComponent(orderId)}`, { method: "POST", headers: csrfHeaders() });
      if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("無法載入取餐 QR，請稍後再試。");
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "無法載入取餐 QR。");
      setMedia(result.media);
      if (!result.media) setMessage("目前沒有可用取餐 QR；已取餐、取消或改時間的訂單請向店員確認。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "無法載入取餐 QR。"); }
    finally { setBusy(false); }
  }
  return <section className="grid justify-items-start gap-3 rounded-lg border border-stone-200 p-4" aria-label="取餐 QR">
    <button type="button" disabled={busy} onClick={() => void show()} className="min-h-11 rounded-md bg-teal-800 px-4 py-2 font-semibold text-white disabled:opacity-50">{busy ? "讀取中…" : "顯示／更新取餐 QR"}</button>
    {media ? <>
      {/* The capability image is served directly; Next image optimization must not cache it. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={media.imageUrl} alt="請於餐點完成後出示，由店員核對交付的取餐 QR" width={320} height={320} referrerPolicy="no-referrer" className="h-auto max-w-full bg-white" onError={() => { setMedia(null); setMessage("此 QR 已失效，請重新讀取或請店員協助。"); }} />
      <p className="text-sm text-stone-600">請於餐點完成後出示，由店員確認交付。有效至 {new Date(media.expiresAt).toLocaleString("zh-TW")}。請勿轉傳取餐碼。</p>
    </> : null}
    <p role="status" className="text-sm text-stone-600">{message}</p>
  </section>;
}
