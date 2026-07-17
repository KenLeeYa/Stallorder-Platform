import { redirect } from "next/navigation";

type PageProps = { params: Promise<{ stallId: string }> };

export default async function StallStaffPage({ params }: PageProps) {
  const { stallId } = await params;
  redirect(`/merchant/stalls/${stallId}#stall-team`);
}
