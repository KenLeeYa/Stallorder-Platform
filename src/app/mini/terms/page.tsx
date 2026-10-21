import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
export default function TermsPage() {
  const runtime = getLinePlatformRuntime();
  return <main className="mx-auto max-w-lg space-y-4 p-4"><h1 className="text-2xl font-bold">平台會員條款與隱私說明</h1>
    <p>版本：{runtime?.termsVersion ?? "尚未設定"}</p>
    <p>攤點通以經 LINE 驗證的識別資料建立平台會員，保存您同意的條款版本與時間，讓您查看自己在合作店家的訂單。</p>
    <p>各店訂單與 LINE Pay 款項由該店獨立處理。平台會員不會取得商家員工權限，也不會將您的訂單開放給其他顧客。</p>
    <p>訂單與取餐通知由攤點通官方帳號提供，需另行同意交易通知；此同意不包含行銷或廣告。您可在會員中心隨時關閉通知，訂單查詢仍可使用。</p>
    <p>取餐 QR 是有期限的一次性憑證，請勿轉傳。歷史帳務紀錄依適用的保存政策處理；個人資料查詢、停用及刪除請向平台管理者提出。</p>
    {runtime?.environment !== "production" && <p className="rounded-lg border border-amber-500 p-3">本頁為隔離測試版；正式啟用前須確認營運主體、聯絡窗口及完整隱私政策。</p>}
  </main>;
}
