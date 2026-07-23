import Link from "next/link";
import { ArrowLeft } from "lucide-react";

export function StallSettingsBackLink({ stallId }: { stallId: string }) {
  return (
    <Link
      href={`/merchant/stalls/${stallId}`}
      className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"
    >
      <ArrowLeft className="h-4 w-4" />
      返回攤位設定
    </Link>
  );
}
