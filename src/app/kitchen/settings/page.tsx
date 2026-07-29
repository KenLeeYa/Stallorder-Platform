import { redirect } from "next/navigation";
import { requireKitchenPage } from "@/lib/kitchen-access";

type PageProps = { searchParams: Promise<{ stall?: string }> };

export default async function KitchenSettingsPage({ searchParams }: PageProps) {
  const { stall: requestedStall } = await searchParams;
  const access = await requireKitchenPage(requestedStall, "MANAGE_KDS");
  redirect(`/merchant/stalls/${access.stall.id}/kitchen/settings`);
}
