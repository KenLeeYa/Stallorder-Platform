import { redirect } from "next/navigation";
import { requirePagePermission } from "@/lib/authorization";

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function LegacyStallReportsPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall } = await requirePagePermission(
    stallSlug,
    "VIEW_REPORTS",
    `/merchant/${stallSlug}/reports`,
  );
  redirect(`/merchant/reports/overview?organizationId=${stall.organizationId}&stallId=${stall.id}`);
}
