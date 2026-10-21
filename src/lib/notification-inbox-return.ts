import type { InboxScope } from "@/lib/notification-inbox-contract";

export function inboxReturnPath(scope: InboxScope): string {
  switch (scope.kind) {
    case "ORGANIZATION": return `/merchant/dashboard?organizationId=${encodeURIComponent(scope.organizationId)}`;
    case "STALL": return `/staff/${encodeURIComponent(scope.stallSlug)}`;
    case "ADMIN_APPLICATION": return `/admin/merchant-applications/${encodeURIComponent(scope.applicationId)}`;
    case "PERSONAL": return "/onboarding/status";
  }
}
