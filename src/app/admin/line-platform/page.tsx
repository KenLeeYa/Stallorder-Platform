import { requirePlatformAdminPage } from "@/lib/authorization";
import { LineWebhookManagement } from "@/components/line-webhook-management";
import { LinePlatformNotificationDashboard } from "@/components/line-platform-notification-dashboard";

export const dynamic = "force-dynamic";
export const metadata = { title: "平台 LINE 通知", robots: { index: false, follow: false } };
export default async function LinePlatformAdminPage() {
  await requirePlatformAdminPage("/admin/line-platform");
  return <><LinePlatformNotificationDashboard /><LineWebhookManagement /></>;
}
