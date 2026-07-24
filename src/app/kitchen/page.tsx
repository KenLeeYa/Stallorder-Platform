import { KitchenBoard } from "@/components/kitchen-board";
import { KitchenNavigation } from "@/components/kitchen-navigation";
import { requireKitchenPage } from "@/lib/kitchen-access";
import { getKitchenBoardData } from "@/lib/kitchen";
import { hasPermission } from "@/lib/rbac";

type PageProps = { searchParams: Promise<{ stall?: string }> };

export default async function KitchenPage({ searchParams }: PageProps) {
  const { stall: requestedStall } = await searchParams;
  const access = await requireKitchenPage(requestedStall, "VIEW_KDS", "/kitchen");
  const initialData = await getKitchenBoardData(access.stall.organizationId, access.stall.id);
  const canManage = access.roles.some((role) => hasPermission(role, "MANAGE_KDS"));
  return (
    <>
      <KitchenNavigation active="BOARD" stall={access.stall} availableStalls={access.availableStalls} canManage={canManage} />
      <KitchenBoard stall={access.stall} initialData={initialData} role={access.role} />
    </>
  );
}
