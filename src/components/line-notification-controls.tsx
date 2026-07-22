"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { BellRing, LoaderCircle, MessageCircle, RotateCcw } from "lucide-react";
import {
  getOrCreateDeviceId,
  parseEdgeResponse,
  publicEdgeHeaders,
  publicEdgeUrl,
} from "@/lib/public-order-client";

type LinkStatus = {
  available: boolean;
  linked: boolean;
  displayName: string;
  officialAccountUrl: string;
  repeatOrderAvailable: boolean;
};

export function LineNotificationControls({ trackingToken }: { trackingToken: string }) {
  const [status, setStatus] = useState<LinkStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const command = useCallback(async (action: "STATUS" | "START" | "REVOKE") => {
    const response = await fetch(publicEdgeUrl("manage-line-link"), {
      method: "POST",
      headers: { "Content-Type": "application/json", ...publicEdgeHeaders() },
      body: JSON.stringify({ action, trackingToken, deviceId: getOrCreateDeviceId() }),
      cache: "no-store",
    });
    const payload = await parseEdgeResponse(response);
    if (!response.ok) throw new Error(String(payload.error ?? "目前無法處理 LINE 通知設定。"));
    return payload;
  }, [trackingToken]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const result = new URLSearchParams(window.location.search).get("line");
      if (result === "linked") setMessage("已完成 LINE 取餐通知綁定。");
      else if (result === "error") setMessage("LINE 綁定未完成，請重新操作。");
      void command("STATUS")
        .then((payload) => setStatus(payload as unknown as LinkStatus))
        .catch(() => setStatus(null));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [command]);

  async function start() {
    setBusy(true);
    setMessage("");
    try {
      const payload = await command("START");
      const authorizationUrl = String(payload.authorizationUrl ?? "");
      if (!authorizationUrl.startsWith("https://access.line.me/")) throw new Error("LINE 授權網址無效。");
      window.location.assign(authorizationUrl);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法連結 LINE。");
      setBusy(false);
    }
  }

  async function revoke() {
    if (!window.confirm("確定停止此訂單的 LINE 取餐通知？")) return;
    setBusy(true);
    setMessage("");
    try {
      await command("REVOKE");
      setStatus((current) => current ? { ...current, linked: false } : current);
      setMessage("已停止 LINE 取餐通知。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法停止 LINE 通知。");
    } finally {
      setBusy(false);
    }
  }

  if (!status?.available && !status?.repeatOrderAvailable) return null;
  return (
    <section className="mt-7 border-y border-stone-200 py-5">
      <div className="flex items-center gap-3">
        <MessageCircle className="h-5 w-5 text-emerald-700" />
        <div>
          <h2 className="font-semibold">{status.displayName || "LINE 取餐通知"}</h2>
          <p className="mt-1 text-xs text-stone-500">{status.linked ? "已連結" : "尚未連結"}</p>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        {status.available && !status.linked ? (
          <button type="button" onClick={() => void start()} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-emerald-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />}
            使用 LINE 接收通知
          </button>
        ) : null}
        {status.linked ? (
          <button type="button" onClick={() => void revoke()} disabled={busy} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">
            停止 LINE 通知
          </button>
        ) : null}
        {status.repeatOrderAvailable ? (
          <Link href={`/order/${encodeURIComponent(trackingToken)}/reorder`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 px-4 text-sm font-semibold text-teal-800">
            <RotateCcw className="h-4 w-4" />再次點餐
          </Link>
        ) : null}
      </div>
      {status.officialAccountUrl ? <a href={status.officialAccountUrl} target="_blank" rel="noreferrer" className="mt-3 inline-block text-sm font-semibold text-emerald-800 underline">開啟店家 LINE 官方帳號</a> : null}
      {message ? <p role="status" className="mt-3 text-sm text-stone-700">{message}</p> : null}
    </section>
  );
}
