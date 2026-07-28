import { KitchenBoard } from "@/components/kitchen-board";
import { KitchenNavigation } from "@/components/kitchen-navigation";
import { requireKitchenPage } from "@/lib/kitchen-access";
import { getKitchenBoardData } from "@/lib/kitchen";
import { createPerformanceTiming } from "@/lib/performance-timing";
import { hasPermission } from "@/lib/rbac";
import { createRequestId } from "@/lib/security";
import { buildWorkModeDestinations } from "@/lib/work-mode";

type PageProps = { searchParams: Promise<{ stall?: string }> };

export default async function KitchenPage({ searchParams }: PageProps) {
  const timing = createPerformanceTiming({
    route: "/kitchen",
    requestId: createRequestId(),
  });
  const { stall: requestedStall } = await searchParams;
  const access = await timing.measure(
    "authMs",
    () => timing.measureDb(
      () => requireKitchenPage(requestedStall, "VIEW_KDS"),
      4,
    ),
  );
  const initialData = await timing.measureDb(
    () => getKitchenBoardData(access.stall.organizationId, access.stall.id),
    4,
  );
  timing.finish({ status: 200 });
  const canManage = access.roles.some((role) => hasPermission(role, "MANAGE_KDS"));
  const workModeDestinations = buildWorkModeDestinations([{
    id: access.stall.organizationId,
    businessName: access.stall.organization.businessName,
    roles: access.roles,
    stalls: [{
      id: access.stall.id,
      name: access.stall.name,
      slug: access.stall.slug,
      isActive: access.stall.isActive,
      roles: access.roles,
    }],
  }]);
  return (
    <>
      <KitchenNavigation
        active="BOARD"
        stall={access.stall}
        availableStalls={access.availableStalls}
        canManage={canManage}
        workModeDestinations={workModeDestinations}
      />
      <KitchenBoard stall={access.stall} initialData={initialData} role={access.role} />
    </>
  );
}
