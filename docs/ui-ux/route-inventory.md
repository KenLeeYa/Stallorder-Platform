# 實際頁面入口盤點

基準 5cc15c6；由 page.tsx 路徑與直接 guard 呼叫擷取。此表不是滲透測試結果；動態參數的實際物件權限仍須執行案例確認。

頁面檔案：111。

| 路由模板 | 真實檔案 | 頁面直接引用 guard |
|---|---|---|
| `/admin/add-ons` | `src/app/admin/add-ons/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/billing` | `src/app/admin/billing/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/delivery-connections/[connectionId]` | `src/app/admin/delivery-connections/[connectionId]/page.tsx` | requireAdminModuleVisible, requirePlatformAdminPage |
| `/admin/delivery-integrations/[requestId]` | `src/app/admin/delivery-integrations/[requestId]/page.tsx` | requireAdminModuleVisible, requirePlatformAdminPage |
| `/admin/delivery-integrations` | `src/app/admin/delivery-integrations/page.tsx` | requireAdminModuleVisible, requirePlatformAdminPage |
| `/admin/e-invoice` | `src/app/admin/e-invoice/page.tsx` | requirePlatformAdminPage |
| `/admin/entitlements` | `src/app/admin/entitlements/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/health` | `src/app/admin/health/page.tsx` | requirePlatformAdminPage |
| `/admin/invoices/[invoiceId]` | `src/app/admin/invoices/[invoiceId]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/invoices` | `src/app/admin/invoices/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/login-methods` | `src/app/admin/login-methods/page.tsx` | requirePlatformAdminPage |
| `/admin/merchant-applications/[applicationId]` | `src/app/admin/merchant-applications/[applicationId]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/merchant-applications` | `src/app/admin/merchant-applications/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/merchant-business-types` | `src/app/admin/merchant-business-types/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/payment-integrations` | `src/app/admin/payment-integrations/page.tsx` | requireAdminModuleVisible, requirePlatformAdminPage |
| `/admin/payments` | `src/app/admin/payments/page.tsx` | requireAdminModuleVisible |
| `/admin/plan-versions` | `src/app/admin/plan-versions/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/plans` | `src/app/admin/plans/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/subscriptions/[subscriptionId]` | `src/app/admin/subscriptions/[subscriptionId]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/subscriptions` | `src/app/admin/subscriptions/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/admin/usage` | `src/app/admin/usage/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/attendance/[stallSlug]` | `src/app/attendance/[stallSlug]/page.tsx` | requirePagePermission |
| `/auth/link/[token]` | `src/app/auth/link/[token]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/display/[stallSlug]` | `src/app/display/[stallSlug]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/display/q/[displayToken]` | `src/app/display/q/[displayToken]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/invite/[token]` | `src/app/invite/[token]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/kitchen` | `src/app/kitchen/page.tsx` | hasPermission, requireKitchenPage |
| `/kitchen/settings` | `src/app/kitchen/settings/page.tsx` | requireKitchenPage |
| `/kitchen/stations` | `src/app/kitchen/stations/page.tsx` | requireKitchenPage |
| `/launch` | `src/app/launch/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/login` | `src/app/login/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/merchant/[stallSlug]` | `src/app/merchant/[stallSlug]/page.tsx` | hasPermission, requirePagePermission |
| `/merchant/[stallSlug]/reports` | `src/app/merchant/[stallSlug]/reports/page.tsx` | requirePagePermission |
| `/merchant/account/security` | `src/app/merchant/account/security/page.tsx` | requireWorkspacePage |
| `/merchant/analytics/advanced` | `src/app/merchant/analytics/advanced/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/billing/invoices/[invoiceId]` | `src/app/merchant/billing/invoices/[invoiceId]/page.tsx` | requireBillingWorkspace |
| `/merchant/billing/invoices` | `src/app/merchant/billing/invoices/page.tsx` | requireBillingWorkspace |
| `/merchant/billing` | `src/app/merchant/billing/page.tsx` | requireBillingWorkspace |
| `/merchant/catalog` | `src/app/merchant/catalog/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/catalog/versions` | `src/app/merchant/catalog/versions/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/dashboard` | `src/app/merchant/dashboard/page.tsx` | hasPermission, requireUsableSubscription, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/developer` | `src/app/merchant/developer/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/enhancements` | `src/app/merchant/enhancements/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/event-growth` | `src/app/merchant/event-growth/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/events` | `src/app/merchant/events/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/growth` | `src/app/merchant/growth/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/integrations/delivery/[connectionId]/logs` | `src/app/merchant/integrations/delivery/[connectionId]/logs/page.tsx` | requireMerchantDeliveryPage |
| `/merchant/integrations/delivery/[connectionId]/menu-mapping` | `src/app/merchant/integrations/delivery/[connectionId]/menu-mapping/page.tsx` | requireMerchantDeliveryPage |
| `/merchant/integrations/delivery/[connectionId]/orders` | `src/app/merchant/integrations/delivery/[connectionId]/orders/page.tsx` | requireMerchantDeliveryPage |
| `/merchant/integrations/delivery/[connectionId]` | `src/app/merchant/integrations/delivery/[connectionId]/page.tsx` | requireMerchantDeliveryPage |
| `/merchant/integrations/delivery/[connectionId]/stores` | `src/app/merchant/integrations/delivery/[connectionId]/stores/page.tsx` | requireMerchantDeliveryPage |
| `/merchant/integrations/delivery` | `src/app/merchant/integrations/delivery/page.tsx` | requireMerchantDeliveryPage |
| `/merchant/integrations/e-invoice` | `src/app/merchant/integrations/e-invoice/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/integrations` | `src/app/merchant/integrations/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/localization` | `src/app/merchant/localization/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/localization/preview` | `src/app/merchant/localization/preview/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/operating-profit` | `src/app/merchant/operating-profit/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/operations` | `src/app/merchant/operations/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/organization` | `src/app/merchant/organization/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/payments` | `src/app/merchant/payments/page.tsx` | hasPermission, requireAdminModuleVisible, requireWorkspacePage |
| `/merchant/plans` | `src/app/merchant/plans/page.tsx` | requireBillingWorkspace |
| `/merchant/report-schedules` | `src/app/merchant/report-schedules/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/reports/cash-shifts` | `src/app/merchant/reports/cash-shifts/page.tsx` | requireReportScope |
| `/merchant/reports/orders` | `src/app/merchant/reports/orders/page.tsx` | requireReportScope |
| `/merchant/reports/overview` | `src/app/merchant/reports/overview/page.tsx` | requireReportScope, requireUsableSubscription |
| `/merchant/reports/payments` | `src/app/merchant/reports/payments/page.tsx` | requireReportScope, requireUsableSubscription |
| `/merchant/reports/products` | `src/app/merchant/reports/products/page.tsx` | requireReportScope, requireUsableSubscription |
| `/merchant/reports/stalls` | `src/app/merchant/reports/stalls/page.tsx` | requireReportScope, requireUsableSubscription |
| `/merchant/setup` | `src/app/merchant/setup/page.tsx` | requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/stalls/[stallId]/attendance` | `src/app/merchant/stalls/[stallId]/attendance/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/capacity` | `src/app/merchant/stalls/[stallId]/capacity/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/cash-shifts` | `src/app/merchant/stalls/[stallId]/cash-shifts/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/dashboard` | `src/app/merchant/stalls/[stallId]/dashboard/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/display` | `src/app/merchant/stalls/[stallId]/display/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/kitchen/settings` | `src/app/merchant/stalls/[stallId]/kitchen/settings/page.tsx` | requireKitchenManagementPage |
| `/merchant/stalls/[stallId]/kitchen/stations` | `src/app/merchant/stalls/[stallId]/kitchen/stations/page.tsx` | requireKitchenManagementPage |
| `/merchant/stalls/[stallId]/line` | `src/app/merchant/stalls/[stallId]/line/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/locations` | `src/app/merchant/stalls/[stallId]/locations/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/offline` | `src/app/merchant/stalls/[stallId]/offline/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/orders` | `src/app/merchant/stalls/[stallId]/orders/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]` | `src/app/merchant/stalls/[stallId]/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/products` | `src/app/merchant/stalls/[stallId]/products/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/qr-print` | `src/app/merchant/stalls/[stallId]/qr-print/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/schedule` | `src/app/merchant/stalls/[stallId]/schedule/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/settings/[section]` | `src/app/merchant/stalls/[stallId]/settings/[section]/page.tsx` | hasPermission, requireWorkspacePage |
| `/merchant/stalls/[stallId]/staff` | `src/app/merchant/stalls/[stallId]/staff/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/merchant/stalls/new` | `src/app/merchant/stalls/new/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/stalls` | `src/app/merchant/stalls/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/subscription` | `src/app/merchant/subscription/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/merchant/supply` | `src/app/merchant/supply/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/team` | `src/app/merchant/team/page.tsx` | requireWorkspaceOrganization, requireWorkspacePage |
| `/merchant/usage` | `src/app/merchant/usage/page.tsx` | requireBillingWorkspace |
| `/merchant/workforce` | `src/app/merchant/workforce/page.tsx` | hasPermission, requireWorkspaceOrganization, requireWorkspacePage |
| `/offline` | `src/app/offline/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/onboarding/edit` | `src/app/onboarding/edit/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/onboarding` | `src/app/onboarding/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/onboarding/status` | `src/app/onboarding/status/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/operator/health` | `src/app/operator/health/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/order/[trackingToken]` | `src/app/order/[trackingToken]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/order/[trackingToken]/reorder` | `src/app/order/[trackingToken]/reorder/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/` | `src/app/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/q/[qrToken]` | `src/app/q/[qrToken]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/s/[stallSlug]/schedule` | `src/app/s/[stallSlug]/schedule/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/select-organization` | `src/app/select-organization/page.tsx` | requireMemberWorkspacePage |
| `/select-stall` | `src/app/select-stall/page.tsx` | requireWorkspaceOrganization, requireWorkspacePage |
| `/staff/[stallSlug]/cash` | `src/app/staff/[stallSlug]/cash/page.tsx` | hasPermission, requirePagePermission |
| `/staff/[stallSlug]/floor` | `src/app/staff/[stallSlug]/floor/page.tsx` | requirePagePermission |
| `/staff/[stallSlug]` | `src/app/staff/[stallSlug]/page.tsx` | hasPermission, requirePagePermission |
| `/staff/[stallSlug]/print` | `src/app/staff/[stallSlug]/print/page.tsx` | requirePagePermission |
| `/staff/login` | `src/app/staff/login/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
| `/store/[identifier]` | `src/app/store/[identifier]/page.tsx` | 由 layout / service 決定；不能據此視為公開 |
