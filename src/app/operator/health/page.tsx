import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { HealthDashboard } from "@/components/health-dashboard";
import { authorizeDrOperatorRequest } from "@/server/resilience/dr-operator-authorization";
import { getDrOperatorReadiness } from "@/server/resilience/dr-operator-readiness";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "DR 備援健康看板", robots: { index: false, follow: false } };

export default async function DrHealthPage() {
  const requestHeaders = await headers();
  const host = requestHeaders.get("host");
  if (!host || !await authorizeDrOperatorRequest(new Request(
    `https://${host}/operator/health`, { headers: requestHeaders },
  ))) notFound();
  const readiness = await getDrOperatorReadiness().catch(() => null);
  return <HealthDashboard kind="dr" readiness={readiness} />;
}
