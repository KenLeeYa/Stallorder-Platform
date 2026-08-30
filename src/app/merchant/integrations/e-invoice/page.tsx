import { notFound } from "next/navigation";
import { MerchantEInvoiceManager } from "@/components/merchant-e-invoice-manager";
import { hasPermission } from "@/lib/rbac";
import { requireWorkspaceOrganization, requireWorkspacePage } from "@/lib/workspace";
import { getMerchantEInvoiceData } from "@/server/e-invoice/e-invoice-service";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantEInvoicePage({ searchParams }: PageProps) {
  const [{ workspaces }, query] = await Promise.all([requireWorkspacePage(), searchParams]);
  const workspace = requireWorkspaceOrganization(workspaces, query.organizationId);
  if (!workspace.roles.some((role) => hasPermission(role, "MANAGE_PAYMENT_INTEGRATIONS"))) notFound();
  const data = await getMerchantEInvoiceData(workspace.id);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-6xl px-4 py-8 md:px-8">
      <header className="mb-7 border-b border-stone-200 pb-5"><p className="text-sm font-semibold text-teal-800">{workspace.businessName} · 財務整合</p><h1 className="mt-1 text-3xl font-semibold">電子發票</h1><p className="mt-2 text-sm text-stone-600">店家自有賣方身分與 Provider 帳號；目前只開放本機 Mock 驗證。</p></header>
      <MerchantEInvoiceManager organizationId={workspace.id} initialData={data} />
    </main>
  );
}
