import Link from "next/link";
import { headers } from "next/headers";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";
export const dynamic = "force-dynamic";
export const metadata = { title: "攤點通 LINE 點餐", robots: { index: false, follow: false } };
export default async function MiniLayout({ children }: { children: React.ReactNode }) {
  let runtime;
  try { runtime = getLinePlatformRuntime(); } catch { runtime = null; }
  if (!runtime) return children;
  const current = await headers();
  if (current.get("host") !== new URL(runtime.endpointUrl).host) return <main className="p-6"><p role="alert">請從攤點通提供的 LINE 入口開啟。</p></main>;
  return <div className="min-h-dvh bg-stone-50 text-stone-950 dark:bg-stone-950 dark:text-stone-100">
    <nav aria-label="攤點通會員導覽" className="grid grid-cols-4 gap-1 border-b border-stone-300 p-2 text-center text-sm">
      {[["/mini", "店家"], ["/mini/orders", "我的訂單"], ["/mini/member", "會員"], ["/mini/help", "協助"]].map(([href,label]) =>
        <Link key={href} href={href} className="flex min-h-11 items-center justify-center rounded-lg px-1 py-2 font-semibold hover:bg-teal-100 dark:hover:bg-teal-950">{label}</Link>)}
    </nav>{children}
  </div>;
}
