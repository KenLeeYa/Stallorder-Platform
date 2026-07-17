import Link from "next/link";
import { ArrowRight, BarChart3, CheckCircle2, LogIn, QrCode, Store, Utensils } from "lucide-react";

export const dynamic = "force-dynamic";

export default function Home() {
  return (
    <main className="min-h-screen">
      <section className="border-b border-stone-200 bg-white">
        <div className="mx-auto grid min-h-[560px] max-w-6xl gap-10 px-5 py-8 md:grid-cols-[1.1fr_0.9fr] md:items-center md:px-8">
          <div>
            <div className="mb-6 flex items-center gap-3 text-sm font-semibold text-teal-800">
              <Store className="h-5 w-5" />
              StallOrder
            </div>
            <h1 className="max-w-3xl text-5xl font-semibold tracking-normal text-stone-950 md:text-7xl">
              StallOrder 攤位點餐
            </h1>
            <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-600">
              顧客掃描桌位或外帶 QR Code 點餐，員工用手機連動廚房與出餐，並以啟用的付款方式完成訂單；每個商戶的商品、訂單與銷售報表皆獨立隔離。
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link
                href="/onboarding"
                className="inline-flex items-center gap-2 rounded-md bg-teal-700 px-5 py-3 text-sm font-semibold text-white hover:bg-teal-800"
              >
                開始商戶申請
                <ArrowRight className="h-4 w-4" />
              </Link>
              <Link
                href="/login"
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-900 hover:bg-stone-100"
              >
                商戶與員工登入
                <LogIn className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="grid gap-4">
            {[
              ["顧客 QR Code 點餐", "適合行動裝置的快速選餐與送單流程。", QrCode],
              ["員工確認訂單", "清楚管理待確認、製作中、可取餐與取消狀態。", CheckCircle2],
              ["多元付款與折扣", "由授權員工記錄付款、折扣、實收與找零。", Utensils],
              ["每日銷售報表", "檢視營業額、訂單數、未付款訂單與熱銷商品。", BarChart3],
            ].map(([title, body, Icon]) => (
              <div key={title as string} className="rounded-lg border border-stone-200 bg-stone-50 p-5">
                <Icon className="mb-4 h-6 w-6 text-teal-700" />
                <h2 className="text-base font-semibold text-stone-950">{title as string}</h2>
                <p className="mt-2 text-sm leading-6 text-stone-600">{body as string}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

    </main>
  );
}
