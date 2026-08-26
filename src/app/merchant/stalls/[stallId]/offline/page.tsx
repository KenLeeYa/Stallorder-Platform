import { notFound } from "next/navigation";
import { TabletSmartphone } from "lucide-react";
import { ContextualBackButton } from "@/components/contextual-back-button";
import {
  OfflineDeviceManager,
} from "@/components/offline-device-manager";
import { OfflineConflictManager } from "@/components/offline-conflict-manager";
import { hasPermission } from "@/lib/rbac";
import { getRequestMerchantMessages } from "@/lib/messages/merchant-server";
import { requireWorkspacePage } from "@/lib/workspace";
import { getOfflineManagementState } from "@/server/offline/offline-device-service";
import { listOfflineSyncConflicts } from "@/server/offline/offline-conflict-service";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function OfflineDeviceSettingsPage({ params }: PageProps) {
  const { m } = await getRequestMerchantMessages();
  const { stallId } = await params;
  const { workspaces } = await requireWorkspacePage();
  const workspace = workspaces.find((candidate) => (
    candidate.stalls.some((stall) => stall.id === stallId)
  ));
  const stall = workspace?.stalls.find((candidate) => candidate.id === stallId);
  if (!workspace || !stall) notFound();

  const roles = [...new Set([...workspace.roles, ...stall.roles])];
  if (!roles.some((role) => hasPermission(role, "MANAGE_STALL"))) notFound();

  const [data, conflicts] = await Promise.all([
    getOfflineManagementState(workspace.id, stallId),
    listOfflineSyncConflicts(workspace.id, stallId),
  ]);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <ContextualBackButton fallbackHref={`/merchant/stalls/${stallId}`}>
        {m("返回攤位設定")}
      </ContextualBackButton>
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold">
          <TabletSmartphone className="h-7 w-7 text-teal-700" />
          {m("離線裝置")}
        </h1>
        <p className="mt-2 text-sm text-stone-600">{stall.name}</p>
      </header>
      <div className="py-7">
        <OfflineDeviceManager
          stallId={stallId}
          initialData={data}
        />
        <OfflineConflictManager
          stallId={stallId}
          initialConflicts={conflicts}
        />
      </div>
    </main>
  );
}
