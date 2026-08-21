import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  fileURLToPath(new URL(
    "../migrations/20260821193000_staff_kds_special_closures.sql",
    import.meta.url,
  )),
  "utf8",
);
const reconciliationSource = readFileSync(
  fileURLToPath(new URL(
    "../migrations/20260821200000_reconcile_staff_kds_special_closure_preflight.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("staff KDS and special-closure migration", () => {
  it("keeps existing stores on KDS without re-enabling an intentional opt-out", () => {
    expect(migrationSource).toContain(
      "add column if not exists kds_module_enabled boolean not null default true;",
    );
    expect(migrationSource).toContain("alter column kds_module_enabled set default false");
    expect(migrationSource).not.toContain("update public.stall_ordering_settings");
  });

  it("creates a tenant-scoped and date-constrained closure table", () => {
    expect(migrationSource).toContain("create table public.stall_special_closures");
    expect(migrationSource).toContain("check (ends_on >= starts_on)");
    expect(migrationSource).toContain("force row level security");
    expect(migrationSource).toContain("app_private.has_stall_role(");
    expect(migrationSource).toContain("'STALL_MANAGER'::public.user_role");
    expect(migrationSource).not.toContain("public.can_manage_stall(stall_id)");
  });

  it("enforces closures at trusted preflight without blocking existing-order recovery", () => {
    expect(migrationSource).toContain("'STALL_SPECIAL_CLOSURE'");
    expect(migrationSource).toContain("v_result->'resumable_order' is not null");
    expect(migrationSource).toContain("v_result->'idempotent_order' is not null");
    expect(migrationSource).toContain("public.public_order_preflight_with_special_closure(");
    expect(migrationSource).toContain("v_result := public.public_order_preflight(");
    expect(migrationSource).not.toContain("alter function public.public_order_preflight(");
    expect(migrationSource).toContain("to service_role");
  });

  it("reconciles databases that already applied the previous migration body", () => {
    expect(reconciliationSource).toContain("from pg_catalog.pg_trigger existing_trigger");
    expect(reconciliationSource).toContain(
      "existing_trigger.tgrelid = 'public.stall_special_closures'::regclass",
    );
    expect(reconciliationSource).toContain("create trigger backend_writable_guard");
    expect(reconciliationSource).toContain(
      "execute function app_private.enforce_backend_writable()",
    );
    expect(reconciliationSource).toContain(
      "create or replace function public.public_order_preflight_with_special_closure(",
    );
    expect(reconciliationSource).toContain("v_result := public.public_order_preflight(");
    expect(reconciliationSource).not.toContain("alter function public.public_order_preflight(");
    expect(reconciliationSource).not.toContain("drop function");
  });

  it("queues confirmation-time printing only for KDS-enabled stores", () => {
    expect(migrationSource).toContain("settings.print_module_enabled");
    expect(migrationSource).toContain("settings.kds_module_enabled");
  });

  it("does not create hidden production work while KDS is disabled", () => {
    expect(migrationSource).toContain("create or replace function public.route_confirmed_order_to_kds()");
    expect(migrationSource).toContain("create or replace function public.route_new_order_item_to_kds()");
    expect(migrationSource).toContain("and settings.kds_module_enabled");
  });
});
