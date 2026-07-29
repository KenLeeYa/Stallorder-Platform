"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { csrfHeaders } from "@/lib/csrf-client";

type Reviewer = { id: string; displayName: string; email: string | null };

export function AdminMerchantApplicationActions({
  applicationId,
  status,
  reviewers,
}: {
  applicationId: string;
  status: string;
  reviewers: Reviewer[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reviewerId, setReviewerId] = useState(reviewers[0]?.id ?? "");
  const [note, setNote] = useState("");
  const [riskLevel, setRiskLevel] = useState("HIGH");
  const isTerminal = ["APPROVED", "REJECTED", "WITHDRAWN", "EXPIRED"].includes(status);

  async function run(command: Record<string, unknown>, success: string) {
    setBusy(true); setError(""); setNotice("");
    try {
      const response = await fetch(`/api/admin/merchant-applications/${applicationId}`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const result = await response.json();
      if (!response.ok) { setError(result.error ?? "目前無法完成操作。"); return; }
      setNotice(success); setNote(""); router.refresh();
    } catch { setError("目前無法連線，請稍後再試。"); }
    finally { setBusy(false); }
  }

  return <section className="space-y-4">
    {error ? <p role="alert" className="border-l-4 border-red-600 bg-red-50 px-4 py-3 text-sm text-red-900">{error}</p> : null}
    {notice ? <p role="status" className="border-l-4 border-teal-600 bg-teal-50 px-4 py-3 text-sm text-teal-900">{notice}</p> : null}
    {status === "WITHDRAWN" ? <section className="border-l-4 border-stone-500 bg-stone-50 px-4 py-3"><h3 className="font-semibold text-stone-900">此案件已結束</h3><p className="mt-1 text-sm text-stone-700">撤回案件不會重新開啟。申請者可沿用原資料建立新申請，平台人員請從「申請歷程」追蹤新的申請編號；此案件僅保留內部紀錄與風險控管。</p></section> : null}
    <details className="border-y border-stone-200 py-4" open><summary className="cursor-pointer font-semibold">{isTerminal ? "內部紀錄" : "指派與內部紀錄"}</summary>{!isTerminal ? <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto]"><select value={reviewerId} onChange={(event) => setReviewerId(event.target.value)} className="min-h-11 border border-stone-300 bg-white px-3">{reviewers.map((reviewer) => <option key={reviewer.id} value={reviewer.id}>{reviewer.displayName} · {reviewer.email}</option>)}</select><button type="button" disabled={busy || !reviewerId} onClick={() => void run({ action: "ASSIGN_REVIEWER", reviewerProfileId: reviewerId }, "審核人已更新。") } className="min-h-11 bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">指派審核人</button></div> : null}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={2000} placeholder="內部審核註記，申請者不可見" className="mt-3 w-full border border-stone-300 p-3 text-sm" /><button type="button" disabled={busy || note.trim().length < 3} onClick={() => void run({ action: "ADD_INTERNAL_NOTE", internalReviewNote: note }, "內部註記已儲存。") } className="mt-2 min-h-11 border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">儲存內部註記</button></details>
    {status === "PENDING_REVIEW" ? <details className="border-b border-stone-200 pb-4"><summary className="cursor-pointer font-semibold">要求補件或核准</summary><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={1000} placeholder="要求補件時，這段說明會顯示給申請者" className="mt-4 w-full border border-stone-300 p-3 text-sm" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || note.trim().length < 3} onClick={() => void run({ action: "REQUEST_INFO", publicReviewNote: note }, "已要求申請者補件。") } className="min-h-11 border border-amber-400 px-4 text-sm font-semibold text-amber-900 disabled:opacity-50">要求補件</button><button type="button" disabled={busy} onClick={() => { if (window.confirm("核准後會建立 Trial 工作區，但 QR 與攤位仍維持關閉。確定核准？")) void run({ action: "APPROVE", internalReviewNote: note.trim() || null }, "申請已核准並建立受控 Trial 環境。"); }} className="min-h-11 bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">核准並建立 Trial</button></div></details> : null}
    {status === "PENDING_REVIEW" ? <details className="border-b border-stone-200 pb-4"><summary className="cursor-pointer font-semibold text-red-800">拒絕或結束申請</summary><textarea value={note} onChange={(event) => setNote(event.target.value)} rows={4} maxLength={1000} placeholder="拒絕理由會顯示給申請者" className="mt-4 w-full border border-stone-300 p-3 text-sm" /><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || note.trim().length < 3} onClick={() => { if (window.confirm("確定拒絕此申請？")) void run({ action: "REJECT", publicReviewNote: note, reapplicationAllowed: false }, "申請已拒絕。"); }} className="min-h-11 bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">拒絕申請</button><button type="button" disabled={busy} onClick={() => { if (window.confirm("確定由平台結束此申請？")) void run({ action: "WITHDRAW", internalReviewNote: note.trim() || null }, "申請已結束。"); }} className="min-h-11 border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">平台撤回</button></div></details> : null}
    <details className="border-b border-stone-200 pb-4"><summary className="cursor-pointer font-semibold">風險與來源控管</summary><div className="mt-4 grid gap-3 sm:grid-cols-[180px_1fr]"><select value={riskLevel} onChange={(event) => setRiskLevel(event.target.value)} className="min-h-11 border border-stone-300 bg-white px-3"><option value="LOW">低</option><option value="MEDIUM">中</option><option value="HIGH">高</option><option value="BLOCKED">已封鎖</option></select><input type="text" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} placeholder="風險判斷原因（內部可見）" className="min-h-11 border border-stone-300 px-3" /></div><div className="mt-3 flex flex-wrap gap-2"><button type="button" disabled={busy || note.trim().length < 3} onClick={() => void run({ action: "MARK_RISK", riskLevel, reason: note }, "風險狀態已更新。") } className="min-h-11 border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">更新風險</button><button type="button" disabled={busy || note.trim().length < 3} onClick={() => { if (window.confirm("封鎖後，相同 IP 雜湊或工作階段來源將無法再次送出申請。確定？")) void run({ action: "BLOCK_SOURCE", reason: note }, "申請來源已封鎖。") }} className="min-h-11 border border-red-300 px-4 text-sm font-semibold text-red-800 disabled:opacity-50">封鎖申請來源</button></div></details>
    {status === "REJECTED" ? <button type="button" disabled={busy} onClick={() => void run({ action: "ALLOW_REAPPLICATION" }, "已允許重新申請。") } className="min-h-11 border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">允許重新申請</button> : null}
  </section>;
}
