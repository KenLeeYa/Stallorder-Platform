import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { resolveMerchantBackNavigation, type MerchantBackSource } from "@/lib/merchant-back-navigation";

type Props = {
  stallId?: string;
  stallSlug?: string;
  organizationId?: string;
  source?: string;
  allowedSources?: readonly MerchantBackSource[];
};

export function StallSettingsBackLink(props: Props) {
  const navigation = resolveMerchantBackNavigation(props);
  if (!navigation) return null;

  return (
    <Link
      href={navigation.href}
      className="inline-flex min-h-10 items-center gap-2 text-sm font-semibold text-teal-800"
    >
      <ArrowLeft className="h-4 w-4" />
      {navigation.label}
    </Link>
  );
}
