import { Store } from "lucide-react";
import { LineMiniAppNavigation } from "@/components/line-miniapp-navigation";
import "./mini.css";
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
  return <div className="mini-shell">
    <header className="mini-brand"><span className="mini-brand-mark"><Store aria-hidden="true" /></span><span><strong>攤點通</strong><small>點好餐，安心取</small></span></header>
    <LineMiniAppNavigation />{children}
  </div>;
}
