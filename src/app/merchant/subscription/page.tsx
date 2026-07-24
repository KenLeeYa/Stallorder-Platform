import { redirect } from "next/navigation";

type PageProps = { searchParams: Promise<{ organizationId?: string }> };

export default async function MerchantSubscriptionPage({ searchParams }: PageProps) {
  const { organizationId } = await searchParams;
  redirect(`/merchant/billing${organizationId ? `?organizationId=${organizationId}` : ""}`);
}
