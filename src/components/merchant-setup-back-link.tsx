import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function MerchantSetupBackLink({ organizationId }: { organizationId: string }) {
  return (
    <Link
      href={`/merchant/setup?organizationId=${encodeURIComponent(organizationId)}`}
      className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"
    >
      <ArrowLeft className="h-4 w-4" />
      返回開店設定
    </Link>
  );
}
