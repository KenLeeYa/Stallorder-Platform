"use client";
import { BellRing } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";
import { readApiJson } from "@/lib/api-response";
import { verifyStaffPushWorker } from "@/lib/staff-push-client";
import { ExperienceDialog } from "./experience-dialog";

type Status = {
  configured: boolean; publicKey: string | null;
  subscriptions: Array<{ id: string; deliveries: Array<{
    id: string; status: string; availableAt: string; sentAt: string | null; displayedAt: string | null; errorCode: string | null;
  }> }>;
};
export function StaffPushControls({ stallSlug }: { stallSlug: string }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState<Status | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [support, setSupport] = useState("");
  const url = "/api/stalls/" + encodeURIComponent(stallSlug) + "/push";
  const refresh = useCallback(async () => {
    const response = await fetch(url, { cache: "no-store" });
    const body = await readApiJson<Status & { error?: string }>(response, "無法讀取推播狀態，請稍後重試。");
    if (!response.ok) throw new Error(body.error ?? "無法讀取推播狀態。");
    setStatus(body);
  }, [url]);
  useEffect(() => {
    if (!open) return;
    const appleMobile = /iPad|iPhone|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const standalone = matchMedia("(display-mode: standalone)").matches
      || (navigator as Navigator & { standalone?: boolean }).standalone;
    const supportMessage = !isSecureContext ? "需要 HTTPS 安全連線，請改用實機測試網址。"
      : appleMobile && !standalone ? "iPad 請用 Safari「分享 → 加入主畫面」，再從主畫面開啟並允許通知（需 iPadOS 16.4 以上）。"
      : !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)
        ? "這個瀏覽器尚不支援 Web Push。Android 請使用 Chrome；iPad 請更新系統。" : "";
    const timer = window.setTimeout(() => { setSupport(supportMessage); void refresh().catch(error => setMessage(error.message)); }, 0);
    const poll = window.setInterval(() => { if (document.visibilityState === "visible") void refresh().catch(() => undefined); }, 10_000);
    return () => { clearTimeout(timer); clearInterval(poll); };
  }, [open, refresh]);

  async function command(data: object) {
    const response = await fetch(url, { method: "POST", headers: csrfHeaders(), body: JSON.stringify(data) });
    const body = await readApiJson<{ error?: string }>(response, "推播服務暫時無法使用，請稍後重試。");
    if (!response.ok) throw new Error(body.error ?? "推播設定失敗，請重試。");
    return body;
  }
  async function run(action: () => Promise<void>) {
    setBusy(true); setMessage("");
    try { await action(); await refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "無法完成推播設定，請稍後重試。"); }
    finally { setBusy(false); }
  }
  async function enable() {
    // Permission must start in the button's user activation (especially iPadOS).
    const permission = await Notification.requestPermission();
    if (permission !== "granted") throw new Error("通知權限未開放，請至裝置設定允許 StallOrder 通知。");
    if (!status?.publicKey) throw new Error("推播服務尚未設定。");
    const registration = await navigator.serviceWorker.register("/sw.js?pwa-enabled=1", { scope: "/" });
    await Promise.race([navigator.serviceWorker.ready, new Promise((_, reject) => setTimeout(() => reject(new Error("通知服務啟動逾時，請重新整理再試。")), 20_000))]);
    await verifyStaffPushWorker(registration);
    const existing = await registration.pushManager.getSubscription();
    // Re-enrol after login/stall changes; never reassign somebody else's queued delivery.
    await command({ operation: "UNSUBSCRIBE" });
    if (existing) await existing.unsubscribe();
    const publicKey = Uint8Array.from(atob(status.publicKey.replaceAll("-", "+").replaceAll("_", "/")), c => c.charCodeAt(0));
    const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: publicKey });
    try { await command({ operation: "SUBSCRIBE", subscription: subscription.toJSON() }); }
    catch (error) { await subscription.unsubscribe(); throw error; }
    setMessage("已開啟新訂單鎖屏通知。可按下測試，再將螢幕鎖定。");
  }
  async function disable() {
    await command({ operation: "UNSUBSCRIBE" });
    if ("serviceWorker" in navigator) {
      const registration = await navigator.serviceWorker.getRegistration("/");
      await (await registration?.pushManager.getSubscription())?.unsubscribe();
    }
    setMessage("這台裝置的鎖屏通知已關閉。");
  }
  const enrolled = status?.subscriptions[0];
  const button = "min-h-11 w-full rounded-lg border border-stone-300 px-4 py-3 text-sm font-semibold disabled:opacity-50";
  return <>
    <button type="button" title="鎖屏通知" aria-label="鎖屏通知" aria-haspopup="dialog" onClick={() => setOpen(true)}
      className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 bg-white text-stone-700">
      <BellRing className="h-5 w-5" />
    </button>
    <ExperienceDialog open={open} onClose={() => setOpen(false)} title="新訂單鎖屏通知">
      <p className="text-sm leading-6">螢幕關閉時也能接收新訂單。結帳、完成及修改訂單不推播；提示音由裝置音量、通知與勿擾設定控制。</p>
      <p className="mt-2 text-sm leading-6 text-stone-600">此處的「30 秒後測試通知」使用手機／Chrome 的通知鈴聲，不會套用商家設定的看板提示音。看板保持在前景且開啟聲音時，新訂單才會播放商家所選音效。</p>
      {support ? <p role="status" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{support}</p> : null}
      {status && !status.configured ? <p role="status" className="mt-3 text-amber-700">尚未設定 Web Push，請聯絡系統管理者。</p> : null}
      <div className="mt-4 grid gap-3">
        <button type="button" className={button + " bg-teal-700 text-white"} disabled={busy || Boolean(support) || !status?.configured}
          onClick={() => void run(enable)}>{enrolled ? "重新連結這台裝置" : "開啟鎖屏通知"}</button>
        <button type="button" className={button} disabled={busy || Boolean(support) || !enrolled} onClick={() => void run(async () => {
          const registration = await navigator.serviceWorker.getRegistration("/");
          if (!registration || !await registration.pushManager.getSubscription()) throw new Error("請先重新連結這台裝置，再測試通知。");
          if (Notification.permission !== "granted") throw new Error("通知權限未開放，請至裝置設定允許此網站通知。");
          await registration.update();
          await verifyStaffPushWorker(registration);
          await command({ operation: "TEST", subscriptionId: enrolled!.id });
          setMessage("已排定 30 秒後測試，現在可鎖屏。本次已要求非靜音通知；實際音效仍依手機的通知與音量設定。收到後點擊即可回到店員看板。");
        })}>30 秒後測試通知</button>
        <button type="button" className={button} disabled={busy || !status?.configured} onClick={() => void run(disable)}>關閉這台裝置通知</button>
      </div>
      {message ? <p role="status" className="mt-4 whitespace-normal rounded-lg bg-stone-100 p-3 text-sm text-stone-800">{message}</p> : null}
      <details className="mt-4 rounded-lg border border-stone-300 p-3 text-sm leading-6">
        <summary className="min-h-11 cursor-pointer content-center font-semibold">收到通知但沒有聲音</summary>
        <p className="mt-2">Android／OPPO 的 Chrome 分頁通知，請檢查這個網站的通知類別。看板上方的聲音按鈕只控制畫面開啟時的新單音效。</p>
        <ol className="mt-2 list-decimal space-y-2 pl-5">
          <li>在手機通知列長按剛收到的 StallOrder 通知，進入通知設定，將該網站設為「快訊／響鈴」，並確認通知鈴聲不是「無」或「靜音」。名稱依 ColorOS 版本而異。</li>
          <li>確認手機的通知／鈴聲音量已提高，且未開啟靜音、勿擾或睡眠模式；只調高媒體音量不會改變通知音量。</li>
          <li>若連續測試時才變安靜，檢查系統是否提供「通知冷卻」並暫時關閉後再測一次。</li>
          <li>設定後按「30 秒後測試通知」並鎖屏。網頁無法替你變更系統通知鈴聲，也不能強制覆蓋靜音或勿擾設定。</li>
        </ol>
        <a className="mt-3 inline-block underline" href="https://support.google.com/android/answer/9079661?hl=zh-Hant" target="_blank" rel="noreferrer">查看 Android 官方通知設定說明</a>
      </details>
      {enrolled?.deliveries.length ? <section className="mt-5 border-t border-stone-200 pt-4">
        <h3 className="font-semibold">最近測試／通知</h3>
        {enrolled.deliveries.map(job => <p key={job.id} className="mt-2 text-sm" data-testid="push-delivery-status">
          {job.displayedAt ? "裝置已回報顯示通知（音效請實機確認）"
            : job.status === "SENT" ? "推播服務已接收，尚未收到裝置顯示回報"
            : job.status === "PENDING" || job.status === "PROCESSING" ? "等待伺服器發送"
            : "未送達，請重新連結裝置後測試"}
        </p>)}
      </section> : null}
    </ExperienceDialog>
  </>;
}
