import { CashShiftBoard, type CashShiftState } from "@/components/cash-shift-board";
import { requirePagePermission } from "@/lib/authorization";
import { getCashShiftState } from "@/lib/cash-shifts";

type PageProps = { params: Promise<{ stallSlug: string }> };

export default async function CashShiftPage({ params }: PageProps) {
  const { stallSlug } = await params;
  const { stall } = await requirePagePermission(stallSlug, "MANAGE_CASH_SHIFT", `/staff/${stallSlug}/cash`);
  const state = await getCashShiftState(stall.id, stall.organizationId);
  return <CashShiftBoard
    stall={{ slug: stall.slug, name: stall.name, currency: stall.currency }}
    initialState={JSON.parse(JSON.stringify(state)) as CashShiftState}
  />;
}
