import { KitchenNavigation } from "@/components/kitchen-navigation";
import { KitchenSettingsForm } from "@/components/kitchen-settings-form";
import { requireKitchenPage } from "@/lib/kitchen-access";
import { getKitchenSettings } from "@/lib/kitchen";

type PageProps = { searchParams: Promise<{ stall?: string }> };

export default async function KitchenSettingsPage({ searchParams }: PageProps) {
  const { stall: requestedStall } = await searchParams;
  const access = await requireKitchenPage(requestedStall, "MANAGE_KDS", "/kitchen/settings");
  const settings = await getKitchenSettings(access.stall.organizationId, access.stall.id);
  return (
    <>
      <KitchenNavigation active="SETTINGS" stall={access.stall} availableStalls={access.availableStalls} canManage />
      <KitchenSettingsForm stallSlug={access.stall.slug} initialSettings={settings} />
    </>
  );
}
