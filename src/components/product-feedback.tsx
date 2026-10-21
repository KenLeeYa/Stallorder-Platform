"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { z } from "zod";
import { csrfHeaders } from "@/lib/csrf-client";
import { OPERATIONS_AUTH_INVALIDATED, retryAfterDeadline } from "@/lib/operations-query";
import { feedbackCommandSchema, feedbackReceiptSchema } from "@/lib/feedback-contract";
export const feedbackControl = "min-h-12 min-w-12 max-w-full rounded-md border border-stone-300 px-3 py-2 disabled:opacity-50";
export function FeedbackDenial() { return <div role="alert">登入或權限已變更，回饋內容已清除。<a href="/login" className={`mt-3 block w-fit ${feedbackControl}`}>重新登入</a></div>; }
export function useFeedbackRequests() {
    const active = useRef(true), requests = useRef(new Set<AbortController>());
    const [denied, setDenied] = useState(false), [retryAt, setRetryAt] = useState<number | null>(null);
    const deny = useCallback(() => { active.current = false; requests.current.forEach(c => c.abort()); requests.current.clear(); setDenied(true); }, []);
    useLayoutEffect(() => { active.current = true; const pending = requests.current; window.addEventListener(OPERATIONS_AUTH_INVALIDATED, deny); return () => { active.current = false; pending.forEach(c => c.abort()); pending.clear(); window.removeEventListener(OPERATIONS_AUTH_INVALIDATED, deny); }; }, [deny]);
    useEffect(() => { if (retryAt === null)
        return; const timer = setTimeout(() => setRetryAt(null), Math.max(0, retryAt - Date.now())); return () => clearTimeout(timer); }, [retryAt]);
    const request = useCallback(async <T,>(url: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T | undefined> => {
        if (!active.current)
            return;
        const controller = new AbortController();
        requests.current.add(controller);
        try {
            const response = await fetch(url, { ...init, cache: "no-store", credentials: "same-origin", signal: controller.signal });
            if (!active.current || controller.signal.aborted)
                return;
            if ([401, 403, 404].includes(response.status)) {
                deny();
                return;
            }
            if (response.status === 429)
                setRetryAt(retryAfterDeadline(response.headers.get("retry-after")) ?? Date.now() + 60000);
            if (!response.ok)
                throw Error(response.status === 409 ? "回饋已被更新，請重新讀取後再操作。" : response.status === 429 ? "操作過於頻繁，請等待限制解除後重試。" : "回饋暫時無法使用，請保留內容並重試。");
            const body: unknown = await response.json();
            if (!active.current || controller.signal.aborted)
                return;
            return schema.parse(body);
        }
        catch (error) {
            if (active.current && !controller.signal.aborted)
                throw error;
        }
        finally {
            requests.current.delete(controller);
        }
    }, [deny]);
    return { denied, request, blocked: retryAt !== null, current: () => active.current };
}
type FeedbackProps = {
    organizationId: string | null;
    requestId?: string;
};
export function ProductFeedback({ identity, ...props }: FeedbackProps & {
    identity: string;
}) { return <Feedback key={identity + props.organizationId + props.requestId} {...props}/>; }
function Feedback(props: FeedbackProps) { const authority = useFeedbackRequests(); return authority.denied ? <FeedbackDenial /> : <FeedbackForm {...props} authority={authority}/>; }
function FeedbackForm({ organizationId, requestId, authority }: FeedbackProps & {
    authority: ReturnType<typeof useFeedbackRequests>;
}) {
    const [reference, setReference] = useState(requestId);
    const [kind, setKind] = useState<"ISSUE" | "SUGGESTION">("ISSUE"), [message, setMessage] = useState(""), [busy, setBusy] = useState(false), [error, setError] = useState("");
    const [receipt, setReceipt] = useState<z.infer<typeof feedbackReceiptSchema> | null>(null);
    async function submit(event: React.FormEvent) {
        event.preventDefault();
        if (busy || authority.blocked)
            return;
        const command = feedbackCommandSchema.safeParse({ organizationId, kind, message, ...(reference ? { requestId: reference } : {}) });
        if (!command.success) {
            setError("請輸入 1 到 2000 字的回饋內容。");
            return;
        }
        setBusy(true);
        setError("");
        try {
            const result = await authority.request("/api/feedback", z.object({ receipt: feedbackReceiptSchema }).strict(), { method: "POST", headers: csrfHeaders(), body: JSON.stringify(command.data) });
            if (result) {
                setReceipt(result.receipt);
                setMessage("");
            }
        }
        catch (error) {
            if (authority.current())
                setError(error instanceof Error ? error.message : "送出失敗，請重試。");
        }
        finally {
            if (authority.current())
                setBusy(false);
        }
    }
    if (receipt)
        return <section className="space-y-3" aria-label="回饋收據"><p role="status">回饋已儲存，平台團隊可查看處理。</p><p className="break-all">收據編號：{receipt.id}</p><p>建立時間：{receipt.createdAt}</p><button type="button" className={feedbackControl} onClick={() => setReceipt(null)}>再寫一則回饋</button></section>;
    return <form onSubmit={submit} className="space-y-4">
  <p>請勿填寫密碼、權杖或顧客個資。回饋由平台管理員處理，作業保留期限為 90 天；備份依既有政策保存。送出回饋不需同意非必要產品分析。</p>
  {reference && <p className="break-all">原錯誤追蹤碼：{reference}（僅連結您本人 24 小時內的錯誤，不授予紀錄存取權。）<button type="button" disabled={busy} className={feedbackControl} onClick={() => setReference(undefined)}>移除追蹤碼</button></p>}
  <label className="block" htmlFor="feedback-kind">回饋類型</label><select id="feedback-kind" value={kind} onChange={e => setKind(e.target.value as typeof kind)} className={feedbackControl} disabled={busy}><option value="ISSUE">問題回報</option><option value="SUGGESTION">功能建議</option></select>
  <label className="block" htmlFor="feedback-message">回饋內容（最多 2000 字）</label><textarea id="feedback-message" value={message} onChange={e => setMessage(e.target.value)} maxLength={2000} rows={7} required disabled={busy} className={`w-full ${feedbackControl}`}/>
  {error && <p role="alert">{error}</p>}<div className="flex flex-wrap gap-3"><button type="submit" disabled={busy || authority.blocked} className={feedbackControl}>{busy ? "送出中…" : "送出回饋"}</button><button type="button" disabled={busy} className={feedbackControl} onClick={() => { setMessage(""); setError(""); }}>清除內容</button></div>
 </form>;
}
