import { PrintQueueBoard, type PrintQueueState } from "@/components/print-queue-board";
import { requirePagePermission } from "@/lib/authorization";
import { getPrintQueueState } from "@/lib/print-queue";

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function PrintQueuePage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall } = await requirePagePermission(stallSlug, "MANAGE_PRINT_QUEUE", `/staff/${stallSlug}/print`);
  const state = await getPrintQueueState(stall.id, stall.organizationId);
  return <PrintQueueBoard
    stall={{ slug: stall.slug, name: stall.name, currency: stall.currency }}
    initialState={JSON.parse(JSON.stringify(state)) as PrintQueueState}
  />;
}
