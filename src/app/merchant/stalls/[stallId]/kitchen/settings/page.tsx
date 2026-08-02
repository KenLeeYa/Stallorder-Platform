import { Settings2 } from "lucide-react";
import { KitchenSettingsForm } from "@/components/kitchen-settings-form";
import { StallSettingsBackLink } from "@/components/stall-settings-back-link";
import { getKitchenSettings } from "@/lib/kitchen";
import { requireKitchenManagementPage } from "@/lib/kitchen-access";

type PageProps = {
  params: Promise<{ stallId: string }>;
  searchParams: Promise<{ source?: string }>;
};

export default async function KitchenDisplaySettingsPage({ params, searchParams }: PageProps) {
  const { stallId } = await params;
  const { source } = await searchParams;
  const { workspace, stall } = await requireKitchenManagementPage(stallId);
  const settings = await getKitchenSettings(workspace.id, stall.id);

  return (
    <main className="mx-auto min-h-[calc(100vh-76px)] max-w-4xl px-4 py-7 md:px-8">
      <StallSettingsBackLink stallId={stall.id} stallSlug={stall.slug} source={source} allowedSources={["kitchen"]} />
      <header className="mt-4 border-b border-stone-200 pb-5">
        <p className="text-sm font-semibold text-teal-800">{workspace.businessName}</p>
        <h1 className="mt-1 flex items-center gap-3 text-3xl font-semibold">
          <Settings2 className="h-7 w-7 text-teal-700" />
          KDS 設定
        </h1>
        <p className="mt-2 text-sm text-stone-600">{stall.name}</p>
      </header>
      <div className="py-7">
        <KitchenSettingsForm stallSlug={stall.slug} initialSettings={settings} />
      </div>
    </main>
  );
}
