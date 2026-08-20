import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, MessageCircle } from "lucide-react";
import { LineIntegrationManager } from "@/components/line-integration-manager";
import { hasPermission } from "@/lib/rbac";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { requireWorkspacePage } from "@/lib/workspace";
import { getLineIntegrationManagerData } from "@/server/notifications/line-integration-service";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function LineIntegrationPage({ params }: PageProps) {
  const { m } = await getRequestMerchantMessages();
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => candidate.stalls.some((stall) => stall.id === stallId));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();
  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_LINE_INTEGRATION"))) notFound();
  const data = await getLineIntegrationManagerData(workspace.id, stallId);
  const appUrl = process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ?? "http://localhost:3000";

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      <Link href={`/merchant/stalls/${stallId}`} className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"><ArrowLeft className="h-4 w-4" />{m("返回攤位設定")}</Link>
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold"><MessageCircle className="h-7 w-7 text-emerald-700" />{m("LINE 訂單通知")}</h1>
        <p className="mt-2 text-sm text-stone-600">{stall.name}</p>
      </header>
      <div className="py-7"><LineIntegrationManager stallId={stallId} appUrl={appUrl} initialData={data} /></div>
    </main>
  );
}
