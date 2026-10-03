"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { z } from "zod";
import { csrfHeaders } from "@/lib/csrf-client";
import { OPERATIONS_AUTH_INVALIDATED, retryAfterDeadline } from "@/lib/operations-query";
import { inboxItemSchema, inboxListSchema, inboxPreferencesSchema, inboxScopeParams, inboxTargetPath,
  type InboxItem, type InboxList, type InboxPreferences, type InboxScope } from "@/lib/notification-inbox-contract";

const subscribe = () => () => {};
const control = "min-h-12 min-w-12 rounded-md border border-stone-300 px-3 py-2 disabled:opacity-50";
const prefSchema = z.object({ version: z.literal("v1"), preferences: inboxPreferencesSchema }).strict();
const detailSchema = z.object({ version: z.literal("v1"), item: inboxItemSchema }).strict();
const countSchema = z.object({ version: z.literal("v1"), unreadCount: z.number().int().nonnegative(), from: z.iso.datetime(), to: z.iso.datetime() }).strict();
type Props = { scope: InboxScope; identity: string };
type Load = "loading" | "ready" | "error";

function usePrivateInbox() {
  const live = useRef(true);
  const requests = useRef(new Set<AbortController>());
  const [denied, setDenied] = useState(false);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [errorRequestId, setErrorRequestId] = useState<string | null>(null);
  const ready = useSyncExternalStore(subscribe, () => true, () => false);
  const deny = useCallback(() => { live.current = false; requests.current.forEach(c => c.abort()); requests.current.clear(); setDenied(true); }, []);
  useLayoutEffect(() => {
    live.current = true;
    const currentRequests = requests.current;
    window.addEventListener(OPERATIONS_AUTH_INVALIDATED, deny);
    return () => { live.current = false; currentRequests.forEach(c => c.abort()); currentRequests.clear(); window.removeEventListener(OPERATIONS_AUTH_INVALIDATED, deny); };
  }, [deny]);
  useEffect(() => {
    if (retryAt === null) return;
    const timer = setTimeout(() => setRetryAt(null), Math.max(0, retryAt - Date.now()));
    return () => clearTimeout(timer);
  }, [retryAt]);
  const request = useCallback(async <T,>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T | undefined> => {
    if (!live.current) return;
    const controller = new AbortController(); requests.current.add(controller);
    try {
      const response = await fetch(url, { ...init, signal: controller.signal, cache: "no-store", credentials: "same-origin" });
      if (!live.current || controller.signal.aborted) return;
      if ([401, 403, 404].includes(response.status)) { deny(); return; }
      if (response.status === 503) { const ref = z.uuid().safeParse(response.headers.get("x-request-id")); if (ref.success) setErrorRequestId(ref.data); }
      if (response.status === 429) setRetryAt(retryAfterDeadline(response.headers.get("retry-after")) ?? Date.now() + 60_000);
      if (!response.ok) throw new Error(response.status === 409 ? "偏好已更新，請重新讀取偏好後再儲存。" : response.status === 429 ? "操作過於頻繁，請待限制解除後重試。" : "通知暫時無法使用，請重試。");
      const body: unknown = await response.json();
      if (!live.current || controller.signal.aborted) return;
      return schema.parse(body);
    } catch (error) {
      if (!live.current || controller.signal.aborted) return;
      throw error;
    } finally { requests.current.delete(controller); }
  }, [deny]);
  return { denied, ready, request, errorRequestId, blocked: retryAt !== null, current: () => live.current };
}
function Denial() { return <div role="alert"><p>登入或權限已變更，通知內容已清除。</p><a href="/login" className={`mt-3 inline-flex items-center ${control}`}>重新登入</a></div>; }
export function NotificationInboxBadge(props: Props) { return <InboxBadge key={props.identity + JSON.stringify(props.scope)} {...props} />; }
function InboxBadge(props: Props) {
  const authority = usePrivateInbox();
  return authority.denied ? null : <InboxBadgeContent {...props} authority={authority} />;
}
function InboxBadgeContent({ scope, authority }: Props & { authority: ReturnType<typeof usePrivateInbox> }) {
  const { count, error } = useInboxUnread(scope, authority);
  const query = inboxScopeParams(scope);
  return <a href={`/notifications?${query}`} className={`my-3 inline-flex max-w-full items-center gap-2 break-words ${control}`}>通知中心 <span aria-live="polite">{count === null ? error ? "（暫時無法讀取）" : "（讀取中）" : `（${count} 則未讀）`}</span></a>;
}
function useInboxUnread(scope: InboxScope, authority: ReturnType<typeof usePrivateInbox>) {
  const { request, blocked } = authority;
  const [count, setCount] = useState<number | null>(null);
  const [error, setError] = useState(false);
  const query = inboxScopeParams(scope);
  useEffect(() => {
    let current = true;
    let pending = false;
    async function refresh() {
      if (pending || blocked || !current || document.visibilityState === "hidden") return;
      pending = true;
      try {
        const result = await request(`/api/notifications/unread-count?${query}`, countSchema);
        if (current && result) { setCount(result.unreadCount); setError(false); }
      } catch { if (current) { setCount(null); setError(true); } }
      finally { pending = false; }
    }
    void refresh();
    const timer = window.setInterval(() => void refresh(), 60_000);
    const onFocus = () => void refresh();
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);
    return () => { current = false; window.clearInterval(timer); window.removeEventListener("focus", onFocus); document.removeEventListener("visibilitychange", onFocus); };
  }, [query, request, blocked]);
  return { count, error };
}
export function NotificationUnreadStatus(props: Props) {
  return <UnreadStatus key={props.identity + JSON.stringify(props.scope)} {...props} />;
}
function UnreadStatus({ scope }: Props) {
  const authority = usePrivateInbox();
  const { count, error } = useInboxUnread(scope, authority);
  if (authority.denied) return null;
  const label = count === null ? error ? "通知狀態暫時無法讀取" : "正在讀取通知狀態" : `${count} 則未讀通知`;
  return <b aria-live="polite" aria-label={label} title={label} className={`absolute right-0 top-0 grid min-h-5 min-w-5 place-items-center rounded-full px-1 text-[10px] font-semibold ${count && count > 0 ? "bg-red-700 text-white" : "bg-stone-200 text-stone-800"}`}>
    {count === null ? error ? "!" : "…" : count > 99 ? "99+" : count}
  </b>;
}
export function NotificationInbox(props: Props) { return <Inbox key={props.identity + JSON.stringify(props.scope)} {...props} />; }
function Inbox(props: Props) {
  const authority = usePrivateInbox();
  return authority.denied ? <Denial /> : <InboxContents {...props} authority={authority} />;
}
function InboxContents({ scope, authority }: Props & { authority: ReturnType<typeof usePrivateInbox> }) {
  const { ready, request, blocked, current } = authority;
  const [list, setList] = useState<InboxList | null>(null);
  const [status, setStatus] = useState<Load>("loading");
  const [message, setMessage] = useState("");
  const [preferences, setPreferences] = useState<InboxPreferences | null>(null);
  const [detail, setDetail] = useState<InboxItem | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const detailGeneration = useRef(0);
  const query = inboxScopeParams(scope) + filter + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : "");
  useEffect(() => {
    let active = true;
    request(`/api/notifications?${query}`, inboxListSchema).then(result => { if (active && result) { setList(result); setStatus("ready"); } }).catch(() => { if (active) { setMessage("無法讀取通知，請重試。"); setStatus("error"); } });
    return () => { active = false; };
  }, [query, request, revision]);
  const loadPreferences = useCallback(async () => {
    try { const result = await request("/api/notification-preferences", prefSchema); if (result) { setPreferences(result.preferences); setMessage(""); } }
    catch { if (current()) setMessage("無法讀取偏好，請重新讀取。"); }
  }, [request, current]);
  useEffect(() => {
    let active = true;
    request("/api/notification-preferences", prefSchema).then(result => { if (active && result) setPreferences(result.preferences); }).catch(() => { if (active) setMessage("無法讀取偏好，請重新讀取。"); });
    return () => { active = false; };
  }, [request]);
  const refresh = () => { setList(null); setDetail(null); setDetailLoading(false); detailGeneration.current++; setStatus("loading"); setCursor(null); setRevision(v => v + 1); };
  async function openDetail(item: InboxItem) {
    const generation = ++detailGeneration.current; setDetail(null); setDetailLoading(true); setMessage("");
    try { const result = await request(`/api/notifications/${item.source}/${item.id}?${inboxScopeParams(scope)}`, detailSchema); if (result && generation === detailGeneration.current) setDetail(result.item); }
    catch { if (current() && generation === detailGeneration.current) setMessage("無法讀取通知詳情，請再次開啟重試。"); }
    finally { if (current() && generation === detailGeneration.current) setDetailLoading(false); }
  }
  async function markRead(item: InboxItem) {
    setBusy(true); setMessage("");
    try {
      const result = await request(`/api/notifications/${item.source}/${item.id}/read?${inboxScopeParams(scope)}`, z.object({ version: z.literal("v1"), readAt: z.iso.datetime() }).strict(), { method: "PATCH", headers: csrfHeaders(), body: "{}" });
      if (result) { refresh(); setMessage("已儲存您的已讀紀錄。"); }
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "已讀結果待確認，請重新讀取通知。"); }
    finally { if (current()) setBusy(false); }
  }
  async function savePreferences(form: HTMLFormElement) {
    if (!preferences) return;
    const data = new FormData(form); setBusy(true); setMessage("");
    try {
      const result = await request("/api/notification-preferences", prefSchema, { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify({ version: preferences.version, billingVisible: data.has("billingVisible"), applicationVisible: data.has("applicationVisible"), staffOrderVisible: data.has("staffOrderVisible"), analyticsConsent: data.has("analyticsConsent") }) });
      if (result) { setPreferences(result.preferences); refresh(); setMessage("偏好已儲存。"); }
    } catch (error) { if (current()) setMessage(error instanceof Error ? error.message : "偏好儲存失敗，請重試。"); }
    finally { if (current()) setBusy(false); }
  }
  return <div className="min-w-0 space-y-6 [overflow-wrap:anywhere]">
    {authority.errorRequestId && <p>錯誤追蹤碼：{authority.errorRequestId} <a className={`inline-flex items-center ${control}`} href={`/feedback?requestId=${authority.errorRequestId}`}>回報此問題</a></p>}
    <p>此範圍近 30 天通知。未讀數與目前類別、日期及顯示偏好一致。</p>
    <form className="grid min-w-0 gap-3 sm:grid-cols-2" onSubmit={event => {
      event.preventDefault(); if (!ready || busy || blocked) return;
      const data = new FormData(event.currentTarget); const params = new URLSearchParams();
      const category = String(data.get("category") ?? ""); if (category) params.set("category", category);
      if (data.has("unreadOnly")) params.set("unreadOnly", "true");
      const from = String(data.get("from") ?? ""), to = String(data.get("to") ?? "");
      if (from) params.set("from", new Date(`${from}T00:00:00Z`).toISOString());
      if (to) params.set("to", new Date(`${to}T00:00:00Z`).toISOString());
      setFilter(params.size ? `&${params}` : ""); refresh();
    }}>
      <label className="grid gap-1">類別<select name="category" className={control} disabled={!ready || busy || blocked}><option value="">全部類別</option><option value="BILLING">帳務</option><option value="APPLICATION">申請</option><option value="STAFF_ORDER">訂單</option></select></label>
      <label className="flex min-h-12 items-center gap-2" style={{ minHeight: 48 }}><input type="checkbox" name="unreadOnly" disabled={!ready || busy || blocked} />只看未讀</label>
      <label className="grid min-w-0 gap-1">起始日期（UTC，含）<input type="date" name="from" className={`min-w-0 w-full ${control}`} disabled={!ready || busy || blocked} /></label>
      <label className="grid min-w-0 gap-1">截止日期（UTC，不含）<input type="date" name="to" className={`min-w-0 w-full ${control}`} disabled={!ready || busy || blocked} /></label>
      <button type="button" className={control} disabled={!ready || busy || blocked}>套用篩選</button>
    </form>
    {message ? <p role="status">{message}</p> : null}
    {blocked ? <p role="alert">請等待操作限制解除後再重試。</p> : null}
    {status === "loading" ? <p role="status">正在讀取通知…</p> : status === "error" ? <button type="button" className={control} disabled={!ready || blocked} onClick={refresh}>重試通知</button> : <section aria-label="通知列表">
      <h2 className="text-lg font-semibold">未讀 {list?.unreadCount ?? 0} 則</h2>
      {list?.items.length === 0 ? <p className="py-4">目前篩選範圍沒有通知。</p> : <ul className="divide-y">{list?.items.map(item => <li key={`${item.source}:${item.id}`} className="py-3"><button type="button" className={`w-full text-left ${control}`} disabled={!ready || busy || blocked} onClick={() => void openDetail(item)}><strong>{item.title}</strong><span className="ml-2">{item.readAt ? "已讀" : "未讀"}</span><time className="mt-1 block text-sm">{item.createdAt.replace("T", " ").replace("Z", " UTC")}</time></button></li>)}</ul>}
      <div className="flex flex-wrap gap-2"><button type="button" className={control} disabled={!ready || !cursor || busy || blocked} onClick={refresh}>回到第一頁</button><button type="button" className={control} disabled={!ready || !list?.nextCursor || busy || blocked} onClick={() => { setCursor(list?.nextCursor ?? null); setList(null); setDetail(null); setDetailLoading(false); detailGeneration.current++; setStatus("loading"); }}>下一頁</button></div>
    </section>}
    {detailLoading ? <p role="status">正在讀取通知詳情…</p> : null}
    {detail ? <section aria-label="通知詳情" className="rounded border p-4"><h2 className="text-xl font-semibold">{detail.title}</h2><p className="my-3 whitespace-pre-wrap">{detail.message}</p><p>{detail.readAt ? "您已讀取此通知。" : "尚未標記為已讀。"}</p><div className="mt-3 flex flex-wrap gap-2"><button type="button" className={control} disabled={!ready || busy || blocked || !!detail.readAt} onClick={() => void markRead(detail)}>標記為已讀</button><a className={`inline-flex items-center ${control}`} href={inboxTargetPath(detail.target)}>開啟相關頁面</a><button type="button" className={control} onClick={() => { detailGeneration.current++; setDetail(null); }}>關閉詳情</button></div></section> : null}
    <section aria-label="通知偏好" className="border-t pt-5"><h2 className="text-xl font-semibold">個人偏好</h2><p className="my-2">類別選項只影響通知中心與未讀數，不代表訂閱或取消 LINE、推播、Email 或行銷通知。</p>
      {preferences ? <form key={preferences.version} onSubmit={event => { event.preventDefault(); if (ready && !busy && !blocked) void savePreferences(event.currentTarget); }}><fieldset disabled={!ready || busy || blocked}>
        {([["billingVisible", "顯示帳務通知"], ["applicationVisible", "顯示申請通知"], ["staffOrderVisible", "顯示訂單通知"], ["analyticsConsent", "同意非必要產品分析（預設關閉）"]] as const).map(([name, label]) => <label className="flex min-h-12 items-center gap-3" style={{ minHeight: 48 }} key={name}><input type="checkbox" name={name} defaultChecked={preferences[name]} />{label}</label>)}
        <button type="submit" className={`mt-3 ${control}`}>儲存偏好</button></fieldset></form> : <p>偏好尚未讀取。</p>}
      <button type="button" className={`mt-3 ${control}`} disabled={!ready || busy || blocked} onClick={() => void loadPreferences()}>重新讀取偏好</button>
    </section>
  </div>;
}
