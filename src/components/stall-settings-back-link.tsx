import { ContextualBackButton } from "@/components/contextual-back-button";
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
    <ContextualBackButton fallbackHref={navigation.href}>
      {navigation.label}
    </ContextualBackButton>
  );
}
