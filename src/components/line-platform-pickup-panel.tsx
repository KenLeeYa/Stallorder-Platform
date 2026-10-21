"use client";

import { useEffect, useRef, useState } from "react";
import { QrCode, ScanLine } from "lucide-react";
import { ExperienceDialog } from "@/components/experience-dialog";
import { csrfHeaders } from "@/lib/csrf-client";
import type { PickupLookup } from "@/server/line-platform/pickup-contract";
import type { PickupPreview } from "@/server/line-platform/pickup-service";

const button = "min-h-11 rounded-md border border-stone-300 px-3 py-2 text-sm font-semibold disabled:opacity-50";
async function readResponse<T>(response: Response): Promise<T> {
  if (!response.headers.get("content-type")?.includes("application/json")) throw new Error("連線暫時無法確認，請稍後再試。");
  const body = await response.json();
  if (!response.ok) throw new Error(body.error ?? "操作未完成，請重新預覽。");
  return body as T;
}

export function LinePlatformPickupPanel({ stallSlug, orders, onCompleted }: {
  stallSlug: string; orders: Array<{ id: string; orderNo: string }>; onCompleted: () => void;
}) {
  const [enabled, setEnabled] = useState(false);
  const [open, setOpen] = useState(false);
  const [token, setToken] = useState("");
  const [manual, setManual] = useState(false);
  const [orderId, setOrderId] = useState("");
  const [code, setCode] = useState("");
  const [reason, setReason] = useState<"CAMERA_UNAVAILABLE" | "DEVICE_LOST" | "TRACKING_UNAVAILABLE">("CAMERA_UNAVAILABLE");
  const [detailsChecked, setDetailsChecked] = useState(false);
  const [handoffChecked, setHandoffChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<{ value: PickupPreview; credential: PickupLookup; key: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [camera, setCamera] = useState(false);
  const video = useRef<HTMLVideoElement>(null);
  const [management, setManagement] = useState<{ version: number; expiresAt: string | null; pickedUpAt: string | null; revoked: boolean } | null>(null);
  const [managementReason, setManagementReason] = useState("");
  const [expiresAt, setExpiresAt] = useState("");
  const base = `/api/line-platform/pickup/${encodeURIComponent(stallSlug)}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${base}/capability`, { signal: controller.signal, cache: "no-store" })
      .then(readResponse<{ enabled: boolean }>).then((result) => setEnabled(result.enabled)).catch(() => setEnabled(false));
    return () => controller.abort();
  }, [base]);
  useEffect(() => {
    if (!camera || !open) return;
    let stopped = false;
    let stream: MediaStream | undefined;
    let frame = 0;
    async function scan() {
      try {
        const decoder = await import("jsqr");
        if (stopped) return;
        const acquired = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
        stream = acquired;
        if (stopped) { acquired.getTracks().forEach((track) => track.stop()); return; }
        const element = video.current;
        if (!element) { acquired.getTracks().forEach((track) => track.stop()); return; }
        element.srcObject = acquired;
        await element.play();
        const canvas = document.createElement("canvas");
        const context = canvas.getContext("2d", { willReadFrequently: true });
        const tick = () => {
          if (stopped) return;
          if (context && element.videoWidth && element.videoHeight) {
            canvas.width = Math.min(800, element.videoWidth);
            canvas.height = Math.round(element.videoHeight * canvas.width / element.videoWidth);
            context.drawImage(element, 0, 0, canvas.width, canvas.height);
            const data = context.getImageData(0, 0, canvas.width, canvas.height);
            const qr = decoder.default(data.data, data.width, data.height);
            if (qr) {
              if (/^qidaigo:pickup:v1:[A-Za-z0-9_-]{43}$/.test(qr.data)) {
                setToken(qr.data); setSnapshot(null); setManual(false);
                setMessage("已讀取取餐 QR。請先預覽餐點，再確認交付。"); setCamera(false); return;
              }
              setMessage("此 QR 不是攤點通取餐憑證，請改掃顧客訂單中的取餐 QR。");
            }
          }
          frame = requestAnimationFrame(tick);
        };
        tick();
      } catch {
        setCamera(false); setMessage("無法開啟相機。可使用條碼掃描器貼入取餐內容，或改用人工核對。");
      }
    }
    void scan();
    return () => { stopped = true; cancelAnimationFrame(frame); stream?.getTracks().forEach((track) => track.stop()); };
  }, [camera, open]);

  function invalidate() { setSnapshot(null); setHandoffChecked(false); setMessage(""); }
  async function preview() {
    setBusy(true); setMessage(""); setHandoffChecked(false);
    const credential: PickupLookup = manual
      ? { kind: "MANUAL", orderId, code, reason, confirmedCustomerDetails: true }
      : { kind: "QR", token: token.trim() };
    try {
      const value = await readResponse<PickupPreview>(await fetch(`${base}/preview`, {
        method: "POST", headers: csrfHeaders(), body: JSON.stringify(credential),
      }));
      setSnapshot({ value, credential, key: crypto.randomUUID() });
    } catch (error) { setSnapshot(null); setMessage(error instanceof Error ? error.message : "預覽未完成。"); }
    finally { setBusy(false); }
  }
  async function redeem() {
    if (!snapshot || !handoffChecked) return;
    setBusy(true); setMessage("正在確認交付，請勿重複發餐。");
    try {
      const value = await readResponse<PickupPreview & { alreadyRedeemed: boolean }>(await fetch(`${base}/redeem`, {
        method: "POST", headers: csrfHeaders(), body: JSON.stringify({ credential: snapshot.credential,
          expectedVersion: snapshot.value.version, idempotencyKey: snapshot.key, confirmedHandoff: true }),
      }));
      setSnapshot({ ...snapshot, value }); setHandoffChecked(false);
      setMessage(value.alreadyRedeemed ? "此訂單先前已完成取餐，未重複核銷。" : "已確認交付。通知將由平台另外處理。");
      onCompleted();
    } catch (error) { setMessage(error instanceof Error ? error.message : "交付結果未知，請重新預覽。"); }
    finally { setBusy(false); }
  }
  async function loadManagement() {
    setBusy(true); setMessage("");
    try { setManagement(await readResponse(await fetch(`${base}/manage?orderId=${encodeURIComponent(orderId)}`, { cache: "no-store" }))); }
    catch (error) { setManagement(null); setMessage(error instanceof Error ? error.message : "無法查詢憑證。"); }
    finally { setBusy(false); }
  }
  async function manage(operation: "REISSUE" | "REVOKE") {
    if (!management) return;
    setBusy(true); setMessage("");
    try {
      await readResponse(await fetch(`${base}/manage`, { method: "POST", headers: csrfHeaders(), body: JSON.stringify({
        orderId, operation, expectedVersion: management.version, reason: managementReason,
        ...(expiresAt ? { expiresAt: new Date(expiresAt).toISOString() } : {}),
      }) }));
      setManagement(null); setSnapshot(null);
      setMessage(operation === "REISSUE" ? management.version === 0 ? "已發行取餐憑證，請重新預覽餐點並核對交付。" : "已撤銷舊憑證並發行新版，請顧客重新開啟自己的訂單 QR。" : "取餐憑證已撤銷，舊 QR 無法核銷。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "憑證操作未完成。"); }
    finally { setBusy(false); }
  }
  if (!enabled) return null;
  return <>
    <button type="button" title="平台 QR 掃碼交付" aria-label="平台 QR 掃碼交付" aria-haspopup="dialog" aria-expanded={open}
      data-testid="staff-platform-qr-pickup" className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 bg-white text-stone-700 md:order-4"
      onClick={() => { invalidate(); setOpen(true); setCamera(false); }}><QrCode className="h-5 w-5" aria-hidden="true" /></button>
    <ExperienceDialog open={open} title="平台 QR 掃碼交付" onClose={() => { setOpen(false); setCamera(false); }}>
    <section className="grid gap-3" aria-label="平台 QR 交付">
      <p className="text-sm text-stone-600">先核對本店餐點與付款，再於實際交付後確認。掃描與預覽不會完成訂單。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" aria-pressed={!manual} className={`${button} ${!manual ? "border-teal-700 bg-teal-50 text-teal-900" : ""}`} onClick={() => { setManual(false); invalidate(); }}>QR／條碼掃描器</button>
        <button type="button" aria-pressed={manual} className={`${button} ${manual ? "border-teal-700 bg-teal-50 text-teal-900" : ""}`} onClick={() => { setManual(true); setCamera(false); invalidate(); }}>人工核對／憑證管理</button>
      </div>
      {!manual ? <>
        <button type="button" className={`${button} flex items-center justify-center gap-2 bg-teal-800 text-white`} onClick={() => setCamera(!camera)}><ScanLine className="size-5" aria-hidden="true" />{camera ? "關閉相機" : "開啟相機掃描"}</button>
        {camera ? <video ref={video} muted playsInline className="max-h-80 w-full rounded-lg bg-stone-900" aria-label="取餐 QR 掃描相機" /> : null}
        <label className="text-sm">取餐 QR 內容<textarea maxLength={61} aria-label="取餐 QR 內容" value={token} onChange={(event) => { setToken(event.target.value); invalidate(); }} autoComplete="off" spellCheck={false} className="form-input mt-1 min-h-20 w-full break-all" /></label>
      </> : <>
        <label className="text-sm">本店訂單<select className="form-input mt-1 min-h-11 w-full" value={orderId} onChange={(event) => { setOrderId(event.target.value); setManagement(null); setDetailsChecked(false); setCode(""); invalidate(); }}><option value="">請選擇訂單</option>{orders.map((order) => <option key={order.id} value={order.id}>{order.orderNo}</option>)}</select></label>
        <label className="text-sm">顧客短取餐碼<input type="text" className="form-input mt-1 min-h-11 w-full" inputMode="numeric" autoComplete="off" value={code} maxLength={6} onChange={(event) => { setCode(event.target.value.replace(/\D/g, "")); invalidate(); }} /></label>
        <label className="text-sm">人工核對原因<select className="form-input mt-1 min-h-11 w-full" value={reason} onChange={(event) => { setReason(event.target.value as typeof reason); invalidate(); }}><option value="CAMERA_UNAVAILABLE">相機無法使用</option><option value="DEVICE_LOST">顧客裝置遺失</option><option value="TRACKING_UNAVAILABLE">訂單畫面無法使用</option></select></label>
        <label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={detailsChecked} onChange={(event) => { setDetailsChecked(event.target.checked); invalidate(); }} />已核對顧客、餐點及取餐號</label>
        <details className="rounded-md border border-stone-200 p-3"><summary className="min-h-11 cursor-pointer text-sm">尚未產碼、到期、改時間或遺失：憑證管理</summary>
          <div className="grid gap-3"><button type="button" className={button} disabled={!orderId || busy} onClick={() => void loadManagement()}>查詢所選訂單憑證</button>
            {management ? <><p className="text-sm">版本 {management.version} · {management.pickedUpAt ? "已取餐" : management.revoked ? "已撤銷" : management.version === 0 ? "尚未發行" : "未核銷"}{management.expiresAt ? ` · 到期 ${new Date(management.expiresAt).toLocaleString("zh-TW")}` : ""}</p>
              <label className="text-sm">處理原因（至少五個字）<input type="text" className="form-input mt-1 min-h-11 w-full" maxLength={240} value={managementReason} onChange={(event) => setManagementReason(event.target.value)} /></label>
              <label className="text-sm">延遲取餐的新到期時間（選填）<input type="datetime-local" className="form-input mt-1 min-h-11 w-full" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label>
              <div className="flex flex-wrap gap-2"><button type="button" className={button} disabled={busy || Boolean(management.pickedUpAt) || managementReason.trim().length < 5} onClick={() => void manage("REISSUE")}>{management.version === 0 ? "發行取餐憑證" : "撤銷舊碼並重發"}</button><button type="button" className={button} disabled={busy || Boolean(management.pickedUpAt) || management.version === 0 || managementReason.trim().length < 5} onClick={() => void manage("REVOKE")}>撤銷取餐憑證</button></div>
            </> : null}</div>
        </details>
      </>}
      <button type="button" className={button} disabled={busy || (manual ? !orderId || !/^\d{3}$|^\d{6}$/.test(code) || !detailsChecked : !token.trim())} onClick={() => void preview()}>預覽餐點與付款</button>
      {snapshot ? <div className="grid gap-2 rounded-md bg-stone-50 p-3" data-testid="platform-pickup-preview">
        <p className="font-semibold">訂單 {snapshot.value.orderNo} · 取餐號 {snapshot.value.pickupCode ?? "—"}</p>
        <p className="text-sm">{snapshot.value.paymentStatus === "PAID" ? "已付款" : "尚未結清／付款待確認"} · {snapshot.value.pickedUpAt ? `已於 ${new Date(snapshot.value.pickedUpAt).toLocaleString("zh-TW")} 完成取餐` : snapshot.value.status === "READY" ? "餐點已完成" : "尚未可取餐"}</p>
        <ul className="list-inside list-disc text-sm">{snapshot.value.items.map((item, index) => <li key={index}>{item.quantity} × {item.name}</li>)}</ul>
        {snapshot.value.canRedeem ? <><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={handoffChecked} onChange={(event) => setHandoffChecked(event.target.checked)} />已核對並實際交付全部餐點</label><button type="button" className={`${button} bg-teal-800 text-white`} disabled={busy || !handoffChecked} onClick={() => void redeem()}>確認交付／完成取餐</button></> : !snapshot.value.pickedUpAt ? <p className="text-sm text-amber-900">請先於原訂單完成製作及收款；付款或退款待確認時不能交付。</p> : null}
      </div> : null}
      <p role="status" aria-live="polite" className="break-words text-sm text-teal-900">{message}</p>
    </section>
    </ExperienceDialog>
  </>;
}
