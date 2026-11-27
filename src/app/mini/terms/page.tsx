import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
export default function TermsPage() {
  const runtime = getLinePlatformRuntime();
  return <main className="mx-auto max-w-lg space-y-4 p-4"><h1 className="text-2xl font-bold">平台會員條款與隱私說明</h1>
    <p>版本：{runtime?.termsVersion ?? "尚未設定"}</p>
    <p>攤點通以經 LINE 驗證的識別資料建立平台會員，保存您同意的條款版本與時間。</p>
    <p>個人資料查詢、停用及刪除請向平台管理者提出。</p>
    {runtime?.environment !== "production" && <p className="rounded-lg border border-amber-500 p-3">本頁為隔離測試版；正式啟用前須確認營運主體、聯絡窗口及完整隱私政策。</p>}
  </main>;
}
