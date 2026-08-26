import { notFound, redirect } from "next/navigation";
import { Braces } from "lucide-react";
import { DeveloperPlatformManager } from "@/components/developer-platform-manager";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import {
  DeveloperPlatformError,
  getDeveloperPlatformDashboard,
} from "@/server/developer-platform/developer-service";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function DeveloperPlatformPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION"))) notFound();
  let dashboard;
  try {
    dashboard = await getDeveloperPlatformDashboard(workspace.id);
  } catch (error) {
    if (error instanceof DeveloperPlatformError && error.code === "PUBLIC_API_MODULE_DISABLED") notFound();
    throw error;
  }
  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-7xl px-4 py-7 md:px-8">
      <header className="border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold text-stone-950">
          <Braces className="h-7 w-7 text-teal-700" />
          開發者整合
        </h1>
        <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-600">
          管理 Scoped API Key 與 HMAC Webhook。機密只會顯示一次，資料庫不保存明文金鑰。
        </p>
      </header>
      <div className="py-6">
        <DeveloperPlatformManager organizationId={workspace.id} initialDashboard={dashboard} />
      </div>
    </main>
  );
}
