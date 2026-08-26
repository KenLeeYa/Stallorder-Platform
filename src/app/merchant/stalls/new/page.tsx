import { notFound, redirect } from "next/navigation";
import { ContextualBackButton } from "@/components/contextual-back-button";
import { StallEditor } from "@/components/stall-editor";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function NewStallPage({ searchParams }: PageProps) {
  const { m } = await getRequestMerchantMessages();
  const { organizationId } = await searchParams;
  const { workspaces } = await requireWorkspacePage();
  if (!organizationId && workspaces.length > 1) redirect("/select-organization");
  const workspace = requireWorkspaceOrganization(workspaces, organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_ORGANIZATION"))) notFound();

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-3xl px-4 py-7 md:px-8">
      <ContextualBackButton fallbackHref={`/merchant/stalls?organizationId=${workspace.id}`}>{m("返回攤位管理")}</ContextualBackButton>
      <div className="mt-4 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p><h1 className="mt-1 text-3xl font-semibold">{m("新增攤位")}</h1></div>
      <div className="py-7">
        <StallEditor organizationId={workspace.id} initial={{ name: "", code: "", slug: "", description: "", address: "", phone: "", timezone: "Asia/Taipei", currency: "TWD" }} />
      </div>
    </main>
  );
}
