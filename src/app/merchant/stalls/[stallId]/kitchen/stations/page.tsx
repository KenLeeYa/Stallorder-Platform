import { ListTree } from "lucide-react";
import { KitchenStationsManager } from "@/components/kitchen-stations-manager";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { getKitchenStationConfiguration } from "@/lib/kitchen";
import { requireKitchenManagementPage } from "@/lib/kitchen-access";

type PageProps = {
  params: Promise<{ stallId: string }>;
  searchParams: Promise<{ source?: string }>;
};

export default async function KitchenStationsSettingsPage({ params, searchParams }: PageProps) {
  const { stallId } = await params;
  const { source } = await searchParams;
  const { workspace, stall } = await requireKitchenManagementPage(stallId);
  const data = await getKitchenStationConfiguration(workspace.id, stall.id);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-5xl px-4 py-7 md:px-8">
      <StallSettingsBackLink stallId={stall.id} stallSlug={stall.slug} source={source} allowedSources={["kitchen"]} />
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold">
          <ListTree className="h-7 w-7 text-teal-700" />
          KDS 工作站
        </h1>
        <p className="mt-2 text-sm text-stone-600">{stall.name}</p>
      </header>
      <div className="py-7">
        <KitchenStationsManager stallSlug={stall.slug} initialData={data} />
      </div>
    </main>
  );
}
