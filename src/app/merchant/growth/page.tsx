import { notFound, redirect } from "next/navigation";
import { Sparkles } from "lucide-react";
import { GrowthCenter } from "@/components/growth-center";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import {
  getGrowthDashboard,
  GrowthOperationError,
} from "@/server/growth/growth-service";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function GrowthPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION"))) notFound();
  let dashboard;
  try {
    dashboard = await getGrowthDashboard(workspace.id);
  } catch (error) {
    if (error instanceof GrowthOperationError && error.code === "GROWTH_MODULE_DISABLED") notFound();
    throw error;
  }
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold text-stone-950"><Sparkles className="h-7 w-7 text-teal-700" />會員與成長</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">建立有預算、期限、通路與每客上限的優惠活動；集點、推薦、RFM 與自動化共用同意治理。</p>
      </header>
      <div className="py-6"><GrowthCenter organizationId={workspace.id} initialDashboard={dashboard} /></div>
    </main>
  );
}
