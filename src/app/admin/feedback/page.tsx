import { createHash } from "node:crypto";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { AdminFeedback } from "@/components/admin-feedback";
export default async function AdminFeedbackPage() {
    const principal = await requirePlatformAdminPage("/admin/feedback");
    const identity = createHash("sha256").update(JSON.stringify([principal.user.id, principal.sessionId])).digest("hex");
    return <main className="mx-auto max-w-5xl space-y-5 px-4 py-8"><h1 className="text-2xl font-semibold">產品回饋管理</h1><a href="/feedback" className="inline-flex min-h-12 items-center rounded border px-3 py-2">送出產品回饋</a><AdminFeedback identity={identity}/></main>;
}
