import { RefreshCw, WifiOff } from "lucide-react";
import Link from "next/link";

export default function OfflinePage() {
  return (
    <main className="mx-auto grid min-h-screen max-w-xl place-items-center px-5 py-10">
      <section className="w-full border-y border-stone-200 py-10 text-center">
        <WifiOff className="mx-auto h-10 w-10 text-amber-700" aria-hidden="true" />
        <h1 className="mt-5 text-2xl font-semibold">目前沒有網路連線</h1>
        <p className="mt-3 text-sm leading-6 text-stone-600">
          StallOrder 離線時僅保留已載入內容供檢視，不會暫存或背景送出訂單與營運操作。
        </p>
        <Link href="/" className="mt-6 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white">
          <RefreshCw className="h-4 w-4" aria-hidden="true" />
          重新連線
        </Link>
      </section>
    </main>
  );
}
