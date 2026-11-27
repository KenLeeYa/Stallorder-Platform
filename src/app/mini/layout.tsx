import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { LineMiniAppEntry } from "@/components/line-miniapp-entry";
import { getLinePlatformRuntime } from "@/server/line-platform/runtime";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

export default async function MiniLayout({ children }: { children: React.ReactNode }) {
  const runtime = getLinePlatformRuntime();
  if (!runtime || (await headers()).get("host") !== new URL(runtime.endpointUrl).host) notFound();
  return <LineMiniAppEntry liffId={runtime.liffId}>{children}</LineMiniAppEntry>;
}
