import { notFound, redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { EventGrowthCenter } from "@/components/event-growth-center";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import {
  EventGrowthOperationError,
  getEventGrowthDashboard,
} from "@/server/event-growth/event-growth-service";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function EventGrowthPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_MARKET_EVENTS"))) notFound();
  let dashboard;
  try {
    dashboard = await getEventGrowthDashboard(workspace.id);
  } catch (error) {
    if (error instanceof EventGrowthOperationError && error.code === "EVENT_GROWTH_MODULE_DISABLED") notFound();
    throw error;
  }
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold text-stone-950"><Megaphone className="h-7 w-7 text-teal-700" />活動推廣與成效</h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">建立市集推廣代碼、簽章點餐連結與活動費用，並保留可稽核的成效資料基礎。</p>
      </header>
      <div className="py-6"><EventGrowthCenter organizationId={workspace.id} initialDashboard={dashboard} /></div>
    </main>
  );
}
