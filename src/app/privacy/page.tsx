import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "隱私權政策 | StallOrder",
  description: "StallOrder 隱私權政策與個人資料處理說明。",
};

const sections = [
  {
    title: "蒐集的資料",
    content: "我們可能蒐集 Google 帳號提供的姓名、已驗證電子郵件與頭像，以及商戶、攤位、員工、商品、訂單、付款紀錄、操作紀錄及服務所需的裝置與安全事件資料。",
  },
  {
    title: "蒐集與使用目的",
    content: "資料用於身分驗證、權限控管、商戶營運、訂單履行、帳務處理、客服支援、資安防護、稽核、服務改善及依法應辦理的事項。",
  },
  {
    title: "Google 帳號資訊",
    content: "Google 登入僅要求 openid、email 與 profile 基本範圍。StallOrder 不會因登入而要求 Gmail、Google Drive、Google Calendar 或其他無關資料的存取權。",
  },
  {
    title: "訂單與商戶資訊",
    content: "商戶資料依組織與攤位隔離。顧客訂單僅提供給完成訂單、出餐、付款、客服與依法稽核所需的授權人員。",
  },
  {
    title: "保存期間",
    content: "資料依契約、帳務、稅務、爭議處理與資安需求保存；目的消失或法定期間屆滿後，將依適用政策刪除、匿名化或限制處理。正式保存年限須由營運方完成法律審閱。",
  },
  {
    title: "第三方處理者",
    content: "服務可能使用 Vercel、Supabase、Google、Cloudflare 及經核准的郵件或監控供應商。各供應商僅在提供服務所需範圍內處理資料。",
  },
  {
    title: "使用者權利",
    content: "依適用法令，使用者可請求查詢、閱覽、複製、更正、停止蒐集或使用，以及刪除個人資料；部分資料可能因法定義務或權利主張而需繼續保存。",
  },
  {
    title: "聯絡方式",
    content: "正式個人資料聯絡窗口、電子郵件、營業人名稱與地址，須由營運方於公開上線前完成法律審閱並填入。",
  },
];

export default function PrivacyPage() {
  return (
    <main className="min-h-screen bg-white px-4 py-10 text-stone-950 sm:px-6">
      <article className="mx-auto max-w-3xl">
        <Link href="/" className="text-sm font-semibold text-teal-800">返回 StallOrder</Link>
        <header className="mt-8 border-b border-stone-200 pb-8">
          <p className="text-sm font-semibold text-red-700">LEGAL REVIEW REQUIRED</p>
          <h1 className="mt-2 text-4xl font-semibold">隱私權政策</h1>
          <p className="mt-4 leading-7 text-stone-600">
            本頁為正式上線前的繁體中文政策草案，應由熟悉台灣個人資料保護法與實際營運流程的法律專業人員審閱。
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
