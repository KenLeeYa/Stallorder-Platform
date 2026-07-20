import { KitchenNavigation } from "@/components/kitchen-navigation";
import { KitchenStationsManager } from "@/components/kitchen-stations-manager";
import { requireKitchenPage } from "@/lib/kitchen-access";
import { getKitchenStationConfiguration } from "@/lib/kitchen";

type PageProps = { searchParams: Promise<{ stall?: string }> };

export default async function KitchenStationsPage({ searchParams }: PageProps) {
  const { stall: requestedStall } = await searchParams;
  const access = await requireKitchenPage(requestedStall, "MANAGE_KDS", "/kitchen/stations");
  const data = await getKitchenStationConfiguration(access.stall.organizationId, access.stall.id);
  return (
    <>
      <KitchenNavigation active="STATIONS" stall={access.stall} availableStalls={access.availableStalls} canManage />
      <KitchenStationsManager stallSlug={access.stall.slug} initialData={data} />
    </>
  );
}
