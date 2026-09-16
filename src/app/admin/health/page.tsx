import type { Metadata } from "next";
import { HealthDashboard } from "@/components/health-dashboard";
import { requirePlatformAdminPage } from "@/lib/authorization";
import { getDependencyHealthSnapshot } from "@/server/resilience/health-service";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "系統健康看板", robots: { index: false, follow: false } };

export default async function AdminHealthPage() {
  await requirePlatformAdminPage("/admin/health");
  const snapshot = await getDependencyHealthSnapshot().catch(() => null);
  return <HealthDashboard kind="primary" snapshot={snapshot} />;
}
