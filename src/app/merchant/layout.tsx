import { MerchantWorkspaceHeader } from "@/components/merchant-workspace-header";
import { requireWorkspacePage } from "@/lib/workspace";

export default async function MerchantLayout({ children }: { children: React.ReactNode }) {
  const { principal, workspaces } = await requireWorkspacePage();

  return (
    <>
      <MerchantWorkspaceHeader workspaces={workspaces} displayName={principal.user.displayName} />
      {children}
    </>
  );
}
