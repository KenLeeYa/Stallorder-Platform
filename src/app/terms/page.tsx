import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "服務條款 | StallOrder",
  description: "StallOrder 服務條款。",
};

const sections = [
  {
    title: "服務範圍",
    content: "StallOrder 提供商戶建立商品、QR 點餐、員工作業、訂單處理、付款紀錄、報表與相關 SaaS 管理功能。實際啟用項目以商戶方案及系統設定為準。",
  },
  {
    title: "帳號責任",
    content: "使用者應使用本人帳號、妥善保護登入方式與裝置，並確保組織及攤位權限正確。發現未授權使用時，應立即通知管理員並撤銷相關工作階段。",
  },
  {
    title: "商戶責任",
    content: "商戶應確保商品、價格、供應、過敏原、付款方式、營業資訊與消費條件正確，並依法處理食品安全、稅務、退款及消費爭議。",
  },
  {
    title: "點餐服務限制",
    content: "送出訂單不代表商戶已接受製作。公開訂單須由店員確認後才進入製作流程；網路、裝置、庫存或營運狀態可能導致訂單無法成立或延遲。",
  },
  {
    title: "禁止使用",
    content: "不得濫用 QR、偽造訂單、規避驗證或速率限制、干擾服務、未經授權存取資料、侵害他人權利，或將服務用於違法用途。",
  },
  {
    title: "訂閱與費用",
    content: "方案、計費週期、用量限制、稅額、付款期限、升降級與退款條件，應以訂購頁、報價單或雙方契約為準。正式商業條款須於收費前完成法律審閱。",
  },
  {
    title: "服務中斷",
    content: "系統可能因維護、資安事件、第三方服務、網路或不可抗力暫停。StallOrder 將依可行程度提供通知、復原與資料保護措施。",
  },
  {
    title: "資料匯出",
    content: "商戶可依可用功能與契約申請匯出其授權範圍內的商品、訂單與報表資料；匯出內容可能依法令、隱私與安全要求受到限制。",
  },
  {
    title: "終止與停權",
    content: "違反條款、欠費、濫用服務或造成資安風險時，系統得依契約暫停或終止服務。終止後的資料保存、匯出與刪除方式須依適用契約與法令辦理。",
  },
  {
    title: "責任限制",
    content: "正式責任範圍、損害賠償上限、準據法與管轄法院須由營運方依實際商業模式及台灣法令完成法律審閱，本草案不構成法律意見。",
  },
  {
    title: "聯絡方式",
    content: "正式客服與法律通知窗口、電子郵件、營業人名稱及地址，須於公開上線前補齊。",
  },
];

export default function TermsPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-10 text-stone-950 sm:px-6">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-teal-800">返回 StallOrder</Link>
        <header className="mt-8 border-b border-stone-200 pb-8">
          <p className="text-sm font-semibold text-red-700">LEGAL REVIEW REQUIRED</p>
          <h1 className="mt-2 text-4xl font-semibold">服務條款</h1>
          <p className="mt-4 leading-7 text-stone-600">
            本頁為正式上線前的繁體中文條款草案，尚未構成法律意見或最終契約。
          </p>
        </header>
        <div className="divide-y divide-stone-200">
          {sections.map((section) => (
            <section key={section.title} className="py-7">
              <h2 className="text-xl font-semibold">{section.title}</h2>
              <p className="mt-3 leading-7 text-stone-700">{section.content}</p>
            </section>
          ))}
        </div>
      </article>
    </main>
  );
}
