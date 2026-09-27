import { headers } from "next/headers";
import Link from "next/link";
import { getPagePrincipal } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { LineMiniAppLogin } from "@/components/line-miniapp-login";
import { getMiniAppStall, readMiniAppBinding } from "@/server/line-miniapp/runtime";

export const dynamic = "force-dynamic";

export default async function MiniAppPage() {
  let binding;
  try { binding = readMiniAppBinding(); }
  catch { return <main className="mx-auto max-w-lg p-6"><h1 className="text-xl font-semibold">LINE 點餐</h1><p role="status" className="mt-4">店家正在準備 LINE 連線設定，請稍後再試。</p></main>; }
  const requestHeaders = await headers();
  // Public LIFF configuration is only rendered at its configured HTTPS host.
  if (requestHeaders.get("host") !== new URL(binding.endpointUrl).host) {
    return <main className="p-6"><p role="alert">請從店家提供的 LINE 測試入口開啟。</p></main>;
  }
  const stall = await getMiniAppStall(binding);
  const principal = await getPagePrincipal();
  const identity = principal ? await prisma.authIdentity.findFirst({
    where: { profileId: principal.user.id, provider: "LINE", revokedAt: null,
      providerSubject: { startsWith: `miniapp:${binding.providerId}:${binding.internalChannel}:${binding.channelId}:` } },
    select: { id: true },
  }) : null;
  return <main className="mx-auto max-w-lg space-y-6 p-6">
    <h1 className="text-2xl font-bold">{stall.name}</h1>
    {identity ? <p role="status" className="rounded-lg bg-teal-50 p-4 font-semibold text-teal-900">LINE 顧客登入成功</p>
      : <LineMiniAppLogin liffId={binding.liffId} endpointUrl={binding.endpointUrl} />}
    <Link href={`/store/${encodeURIComponent(stall.slug)}?view=menu`} className="inline-flex min-h-12 w-full items-center justify-center rounded-lg border px-4 font-semibold">查看店家菜單</Link>
    <p className="text-sm text-stone-600">測試入口；LINE Pay 收款尚未開放。</p>
  </main>;
}
