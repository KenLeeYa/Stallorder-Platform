import Link from "next/link";
import { ArrowRight, BarChart3, CheckCircle2, QrCode, Store, Utensils } from "lucide-react";
import { prisma } from "@/lib/prisma";

export default async function Home() {
  const stalls = await prisma.stall.findMany({
    orderBy: { createdAt: "asc" },
    take: 6,
    include: {
      organization: true,
      qrCodes: { where: { state: "ACTIVE" }, orderBy: { tokenVersion: "desc" }, take: 1 },
    },
  });

  const demoSlug = stalls[0]?.slug ?? "aming-chicken";
  const demoQrToken = stalls[0]?.qrCodes[0]?.token;

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
              顧客掃描 QR Code 即可點餐，員工用手機確認訂單，取餐時以現金結帳；每個商戶的商品、訂單與銷售報表皆獨立隔離。
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
                href={demoQrToken ? `/q/${demoQrToken}` : `/s/${demoSlug}`}
                className="inline-flex items-center gap-2 rounded-md border border-stone-300 bg-white px-5 py-3 text-sm font-semibold text-stone-900 hover:bg-stone-100"
              >
                體驗示範點餐
                <QrCode className="h-4 w-4" />
              </Link>
            </div>
          </div>
          <div className="grid gap-4">
            {[
              ["顧客 QR Code 點餐", "適合行動裝置的快速選餐與送單流程。", QrCode],
              ["員工確認訂單", "清楚管理待確認、製作中、可取餐與取消狀態。", CheckCircle2],
              ["人工現金結帳", "顧客付款後由授權員工完成結帳。", Utensils],
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

      <section className="mx-auto max-w-6xl px-5 py-10 md:px-8">
        <div className="flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
          <div>
            <h2 className="text-2xl font-semibold">目前攤位</h2>
            <p className="text-sm text-stone-600">每個攤位都有獨立菜單、員工看板與報表權限。</p>
          </div>
        </div>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {stalls.map((stall) => (
            <div key={stall.id} className="rounded-lg border border-stone-200 bg-white p-5">
              <div className="text-sm text-stone-500">{stall.organization.name}</div>
              <h3 className="mt-1 text-xl font-semibold">{stall.name}</h3>
              <p className="mt-1 text-sm text-stone-600">{stall.location}</p>
              <div className="mt-5 flex flex-wrap gap-2">
                {stall.qrCodes[0] ? (
                  <Link className="rounded-md bg-stone-900 px-3 py-2 text-sm font-medium text-white" href={`/q/${stall.qrCodes[0].token}`}>
                    顧客點餐
                  </Link>
                ) : null}
                <Link className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium" href={`/staff/${stall.slug}`}>
                  員工看板
                </Link>
                <Link className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium" href={`/merchant/${stall.slug}`}>
                  商戶管理
                </Link>
                <Link className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium" href={`/merchant/${stall.slug}/reports`}>
                  每日報表
                </Link>
              </div>
            </div>
          ))}
        </div>
        <div className="mt-6">
          <Link href="/login" className="text-sm font-semibold text-teal-800">商戶與員工登入</Link>
        </div>
      </section>
    </main>
  );
}
