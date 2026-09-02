import { LazyKitchenBoard } from "@/components/lazy-kitchen-board";
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
  const workModeDestinations = buildWorkModeDestinations(access.workspaces);
  return (
    <LazyKitchenBoard
      stall={access.stall}
      canManage={canManage}
      workModeDestinations={workModeDestinations}
      initialData={initialData}
      role={access.role}
    />
  );
}
