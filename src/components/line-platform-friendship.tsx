"use client";
import { useEffect, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";

async function checkFriendship(liffId: string) {
  const { default: liff, initializeMiniApp } = await import("@/lib/line-miniapp-liff");
  await initializeMiniApp(liffId);
  const accessToken = liff.isLoggedIn() ? liff.getAccessToken() : null;
  if (!accessToken) throw new Error("LOGIN_REQUIRED");
  const response = await fetch("/api/mini/member/friendship", { method: "POST", credentials: "same-origin",
    cache: "no-store", headers: csrfHeaders(), body: JSON.stringify({ accessToken }) });
  if (!response.ok) throw new Error("FRIENDSHIP_UNAVAILABLE");
  return (await response.json() as { friendship: string }).friendship;
}

export function LinePlatformFriendship({ liffId, initialStatus }: { liffId: string; initialStatus: string }) {
  const [status, setStatus] = useState(initialStatus);
  const [busy, setBusy] = useState(initialStatus === "UNKNOWN");
  const [error, setError] = useState("");
  useEffect(() => {
    if (initialStatus !== "UNKNOWN") return;
    let active = true;
    void checkFriendship(liffId).then(value => { if (active) setStatus(value); }).catch(() => {
      if (active) setError("好友狀態尚未同步，請點選重新確認；若 LINE 登入已過期，請登出後重新登入。");
    }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [liffId, initialStatus]);
  async function refresh() {
    if (busy) return;
    setBusy(true); setError("");
    try { setStatus(await checkFriendship(liffId)); }
    catch { setError("暫時無法確認好友，請稍後再試；若 LINE 登入已過期，請登出後重新登入。"); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    <p role="status">{status === "FRIEND" ? "已確認好友狀態" : status === "NOT_FRIEND_OR_BLOCKED" ? "尚未加入好友或已封鎖" : "尚未確認好友狀態"}</p>
    <button type="button" disabled={busy} onClick={() => void refresh()} className="min-h-11 rounded-lg border px-4 font-semibold disabled:opacity-50">
      {busy ? "確認中…" : "重新確認好友狀態"}
    </button>
    {error && <p role="alert" className="text-sm text-amber-700">{error}</p>}
  </div>;
}
