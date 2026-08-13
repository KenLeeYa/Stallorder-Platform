import { redirect } from "next/navigation";
import { getPagePrincipal } from "@/lib/auth";
import { getDefaultWorkspacePath, getWorkspaceAccess } from "@/lib/workspace";
import { getPendingMerchantSetupPath } from "@/server/merchant-applications/merchant-setup-service";

export const dynamic = "force-dynamic";

export default async function LaunchPage() {
  const principal = await getPagePrincipal();
  if (!principal) redirect("/login");
  if (principal.user.platformRole === "PLATFORM_ADMIN") redirect("/admin/billing");

  const [workspaces, pendingSetupPath] = await Promise.all([
    getWorkspaceAccess(principal.user.id, principal.user.platformRole),
    getPendingMerchantSetupPath(principal.user.id),
  ]);
  redirect(pendingSetupPath ?? getDefaultWorkspacePath(workspaces));
}
