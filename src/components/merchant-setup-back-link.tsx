"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

export function MerchantSetupBackLink({ organizationId }: { organizationId: string }) {
  const { m } = useMerchantMessages();
  return (
    <Link
      href={`/merchant/setup?organizationId=${encodeURIComponent(organizationId)}`}
      className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"
    >
      <ArrowLeft className="h-4 w-4" />
      {m("返回開店設定")}
    </Link>
  );
}
