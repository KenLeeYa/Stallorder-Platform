import { requirePagePermission } from "@/lib/authorization";
import { LinePlatformNotificationDashboard } from "@/components/line-platform-notification-dashboard";

export const dynamic = "force-dynamic";
export default async function StallNotificationsPage({ params }: { params: Promise<{ stallSlug: string }> }) {
  const { stallSlug } = await params;
  const { stall } = await requirePagePermission(stallSlug,"MANAGE_LINE_INTEGRATION",`/merchant/${stallSlug}/notifications`);
  return <LinePlatformNotificationDashboard stallId={stall.id} stallName={stall.name} />;
}
