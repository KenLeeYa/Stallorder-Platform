"use client";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { csrfHeaders } from "@/lib/csrf-client";
import { feedbackItemSchema, feedbackPageSchema, feedbackStatusSchema, type FeedbackItem } from "@/lib/feedback-contract";
import { FeedbackDenial, feedbackControl, useFeedbackRequests } from "./product-feedback";
export function AdminFeedback({ identity }: {
    identity: string;
}) { return <Admin key={identity}/>; }
function Admin() { const authority = useFeedbackRequests(); return authority.denied ? <FeedbackDenial /> : <Contents authority={authority}/>; }
function Contents({ authority }: {
    authority: ReturnType<typeof useFeedbackRequests>;
}) {
    const [initial] = useState(() => new Date());
    const [from, setFrom] = useState(new Date(initial.getTime() - 30 * 86400000).toISOString().slice(0, 10)), [to, setTo] = useState(initial.toISOString().slice(0, 10)), [status, setStatus] = useState(""), [organizationId, setOrganizationId] = useState("");
    const [query, setQuery] = useState(() => new URLSearchParams({ from: new Date(initial.getTime() - 30 * 86400000).toISOString(), to: initial.toISOString(), limit: "25" }).toString());
    const [cursor, setCursor] = useState<string | null>(null), [page, setPage] = useState<z.infer<typeof feedbackPageSchema> | null>(null), [detail, setDetail] = useState<FeedbackItem | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0), [loading, setLoading] = useState(true);
    const detailGeneration = useRef(0), { request } = authority;
    useEffect(() => { let current = true; request(`/api/admin/feedback?${query}${cursor ? `&cursor=${cursor}` : ""}`, feedbackPageSchema).then(result => { if (current && result) {
        setPage(result);
        setLoading(false);
    } }).catch(error => { if (current) {
        setError(error.message);
        setLoading(false);
    } }); return () => { current = false; }; }, [request, query, cursor, revision]);
    function clear() { detailGeneration.current++; setDetail(null); setPage(null); setError(""); setLoading(true); }
    function refresh() { clear(); setCursor(null); setRevision(value => value + 1); }
    async function open(id: string) { const generation = ++detailGeneration.current; setDetail(null); setBusy(true); setError(""); try {
        const result = await request(`/api/admin/feedback/${id}?${query}`, z.object({ item: feedbackItemSchema }).strict());
        if (result && generation === detailGeneration.current)
            setDetail(result.item);
    }
    catch (error) {
        if (authority.current() && generation === detailGeneration.current)
            setError(error instanceof Error ? error.message : "無法讀取詳情。");
    }
    finally {
        if (authority.current() && generation === detailGeneration.current)
            setBusy(false);
    } }
    async function update(status: z.infer<typeof feedbackStatusSchema>) { if (!detail)
        return; const current = detail; setBusy(true); setError(""); try {
        const result = await request(`/api/admin/feedback/${current.id}?${query}`, z.object({ item: feedbackItemSchema }).strict(), { method: "PATCH", headers: csrfHeaders(), body: JSON.stringify({ expectedVersion: current.version, status }) });
        if (result) {
            refresh();
            setError("狀態已儲存。");
        }
    }
    catch (error) {
        if (authority.current())
            setError(error instanceof Error ? error.message : "儲存失敗。");
    }
    finally {
        if (authority.current())
            setBusy(false);
    } }
    return <div className="space-y-5 [overflow-wrap:anywhere]">
  <form className="grid gap-3 sm:grid-cols-2" onSubmit={event => { event.preventDefault(); clear(); setCursor(null); const end = new Date(`${to}T00:00:00.000Z`); end.setUTCDate(end.getUTCDate() + 1); setQuery(new URLSearchParams({ from: new Date(`${from}T00:00:00.000Z`).toISOString(), to: end.toISOString(), limit: "25", ...(status ? { status } : {}), ...(organizationId ? { organizationId } : {}) }).toString()); setRevision(v => v + 1); }}>
   <label className="grid gap-1">起日（UTC）<input type="date" required value={from} onChange={e => setFrom(e.target.value)} className={`w-full ${feedbackControl}`}/></label>
   <label className="grid gap-1">迄日（UTC）<input type="date" required value={to} onChange={e => setTo(e.target.value)} className={`w-full ${feedbackControl}`}/></label>
   <label className="grid gap-1">狀態<select value={status} onChange={e => setStatus(e.target.value)} className={feedbackControl}><option value="">全部</option><option value="NEW">新回饋</option><option value="REVIEWED">已檢閱</option><option value="CLOSED">已結案</option></select></label>
   <label className="grid gap-1">組織編號（選填）<input value={organizationId} onChange={e => setOrganizationId(e.target.value)} className={`w-full ${feedbackControl}`}/></label><button className={feedbackControl} type="submit" disabled={busy || authority.blocked}>套用篩選</button>
  </form>
  <div className="flex flex-wrap gap-3"><button type="button" className={feedbackControl} onClick={refresh} disabled={busy || authority.blocked}>重新讀取</button>{cursor && <button type="button" className={feedbackControl} onClick={() => { clear(); setCursor(null); }} disabled={busy || authority.blocked}>回第一頁</button>}{page?.nextCursor && <button type="button" className={feedbackControl} disabled={busy || authority.blocked} onClick={() => { const next = page.nextCursor; clear(); setCursor(next); }}>下一頁</button>}</div>
  {error && <p role="status">{error}</p>}{loading && <p role="status">讀取回饋中…</p>}{page?.items.length === 0 && <p>此範圍沒有回饋。</p>}
  <ul className="space-y-3">{page?.items.map(item => <li key={item.id} className="rounded border p-3"><p>{item.kind === "ISSUE" ? "問題回報" : "功能建議"} · {item.status} · {item.createdAt}</p><p className="whitespace-pre-wrap">{item.message}</p><button type="button" className={`mt-2 ${feedbackControl}`} disabled={busy || authority.blocked} onClick={() => void open(item.id)}>查看回饋 {item.id.slice(0, 8)}</button></li>)}</ul>
  {detail && <section aria-label="回饋詳情" className="space-y-3 rounded border p-4"><h2 className="font-semibold">回饋詳情</h2><p className="break-all">{detail.id}</p><p className="whitespace-pre-wrap">{detail.message}</p>{detail.requestId && <p>原錯誤追蹤碼：{detail.requestId}</p>}<p>狀態：{detail.status} · 版本：{detail.version}</p><div className="flex flex-wrap gap-3">{feedbackStatusSchema.options.map(status => <button key={status} type="button" className={feedbackControl} disabled={busy || authority.blocked || status === detail.status} onClick={() => void update(status)}>{status === "NEW" ? "標為新回饋" : status === "REVIEWED" ? "標為已檢閱" : "結案"}</button>)}<button type="button" className={feedbackControl} disabled={busy} onClick={() => { detailGeneration.current++; setDetail(null); }}>關閉詳情</button></div></section>}
 </div>;
}
