import { notFound, redirect } from "next/navigation";
import { Boxes } from "lucide-react";
import { SupplyLiteManager } from "@/components/supply-lite-manager";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import {
  getSupplyDashboard,
  SupplyOperationError,
} from "@/server/supply-lite/supply-service";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function SupplyLitePage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_SHARED_PRODUCTS"))) notFound();

  let dashboard;
  try {
    dashboard = await getSupplyDashboard(workspace.id);
  } catch (error) {
    if (error instanceof SupplyOperationError && error.code === "SUPPLY_MODULE_DISABLED") notFound();
    throw error;
  }

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold text-stone-950">
          <Boxes className="h-7 w-7 text-teal-700" />
          Supply Lite 原料與庫存
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
          建立原料、庫位與商品配方，並以不可變、可追溯的庫存流水帳記錄進貨、耗損及調整。
        </p>
      </header>
      <div className="py-6">
        <SupplyLiteManager organizationId={workspace.id} initialDashboard={dashboard} />
      </div>
    </main>
  );
}
