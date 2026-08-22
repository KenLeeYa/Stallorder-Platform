export const environmentLocalTables = Object.freeze([
  "backend_runtime_state",
  "replication_health_snapshots",
]);

export const replicationColumnExclusions = Object.freeze({
  profiles: Object.freeze(["auth_user_id"]),
});

export const replicatedPublicTables = Object.freeze([
  "add_on_catalog",
  "additional_stall_approvals",
  "audit_logs",
  "auth_identities",
  "auth_identity_link_invitations",
  "auth_sessions",
  "backend_failover_events",
  "billing_change_requests",
  "billing_feature_flags",
  "billing_notifications",
  "billing_stall_usage_summaries",
  "billing_usage_summaries",
  "billing_webhook_events",
  "capacity_events",
  "cash_movements",
  "cash_shift_reviews",
  "cash_shifts",
  "checkout_groups",
  "client_devices",
  "customer_contact_links",
  "daily_stall_summaries",
  "delivery_platform_connection_requests",
  "delivery_platform_connections",
  "delivery_sync_jobs",
  "delivery_webhook_events",
  "dining_floors",
  "dining_tables",
  "discount_options",
  "domain_inbox",
  "domain_outbox",
  "external_menu_mappings",
  "external_orders",
  "external_store_mappings",
  "invoice_line_items",
  "invoices",
  "kitchen_station_assignments",
  "kitchen_stations",
  "line_link_sessions",
  "line_webhook_events",
  "manual_payment_records",
  "market_events",
  "menu_snapshots",
  "merchant_application_notifications",
  "merchant_applications",
  "merchant_business_type_options",
  "merchant_setup_progress",
  "notification_integrations",
  "notification_jobs",
  "notification_outbox",
  "offline_order_sync_receipts",
  "offline_permits",
  "offline_stall_runtime_policy",
  "offline_sync_conflicts",
  "operational_alerts",
  "operational_events",
  "oauth_provider_events",
  "oauth_transactions",
  "order_events",
  "order_item_batch_actions",
  "order_item_note_options",
  "order_items",
  "order_production_tasks",
  "order_sessions",
  "orders",
  "organization_invitations",
  "organization_memberships",
  "organizations",
  "payment_attempts",
  "payment_options",
  "payment_provider_customers",
  "payments",
  "pickup_display_settings",
  "plan_entitlements",
  "plan_versions",
  "plans",
  "print_jobs",
  "printers",
  "product_capacity_rules",
  "product_bundle_choice_groups",
  "product_bundle_choices",
  "product_categories",
  "product_groups",
  "product_note_group_assignments",
  "product_note_group_translations",
  "product_note_groups",
  "product_note_option_translations",
  "product_note_options",
  "product_translations",
  "products",
  "profile_auth_identities",
  "profiles",
  "public_lottery_draws",
  "public_order_attempts",
  "public_rate_limit_buckets",
  "qr_codes",
  "rate_limit_buckets",
  "report_deliveries",
  "report_schedules",
  "resilience_feature_flag_overrides",
  "resilience_feature_flags",
  "reusable_product_note_translations",
  "reusable_product_notes",
  "stall_business_hours",
  "stall_capacity_settings",
  "stall_locations",
  "stall_lottery_discount_chances",
  "stall_memberships",
  "stall_order_counters",
  "stall_ordering_settings",
  "stall_products",
  "stall_schedules",
  "stalls",
  "storage_object_manifest",
  "storage_replication_jobs",
  "subscription_items",
  "subscriptions",
  "tax_document_events",
  "tax_documents",
  "usage_events",
]);

export function buildPublicationTableExpression(table, availableColumns = []) {
  if (!replicatedPublicTables.includes(table)) {
    throw new Error("REPLICATION_TABLE_NOT_ALLOWED");
  }

  const qualifiedTable = `${quoteIdentifier("public")}.${quoteIdentifier(table)}`;
  const exclusions = replicationColumnExclusions[table];
  if (!exclusions) return qualifiedTable;

  const uniqueColumns = [...new Set(availableColumns)];
  if (exclusions.some((column) => !uniqueColumns.includes(column))) {
    throw new Error("REPLICATION_EXCLUDED_COLUMN_MISSING");
  }
  const publishedColumns = uniqueColumns.filter(
    (column) => !exclusions.includes(column),
  );
  if (!publishedColumns.includes("id")) {
    throw new Error("REPLICATION_IDENTITY_COLUMN_MISSING");
  }
  return `${qualifiedTable} (${publishedColumns.map(quoteIdentifier).join(", ")})`;
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}
