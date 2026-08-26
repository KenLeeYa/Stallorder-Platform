"use client";

import { ContextualBackButton } from "@/components/contextual-back-button";
import { useMerchantMessages } from "@/lib/messages/merchant-client";

export function MerchantSetupBackLink({ organizationId }: { organizationId: string }) {
  const { m } = useMerchantMessages();
  return (
    <ContextualBackButton fallbackHref={`/merchant/setup?organizationId=${encodeURIComponent(organizationId)}`}>
      {m("返回開店設定")}
    </ContextualBackButton>
  );
}
