import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertAdditiveMigrationSql,
  createAdditiveMigrationPlan,
  parseSupabaseMigrationList,
} from "./additive-migration-plan.mjs";

const reportDeliverySchedulerMigration = readFileSync(resolve(
  import.meta.dirname,
  "../../supabase/migrations/20260820071255_restore_report_delivery_scheduler_contract.sql",
), "utf8");

describe("additive DR migration plan", () => {
  it("parses exact pending versions from ASCII or Unicode Supabase output", () => {
    expect(parseSupabaseMigrationList(`
      LOCAL          | REMOTE         | TIME (UTC)
      20260805000000 | 20260805000000 | 2026-08-05
      20260805000001 |                | 2026-08-05
    `)).toEqual(["20260805000001"]);
    expect(parseSupabaseMigrationList(`
      LOCAL          │ REMOTE         │ TIME (UTC)
      20260805000000 │ 20260805000000 │ 2026-08-05
    `)).toEqual([]);
    expect(parseSupabaseMigrationList(`
      Local            | Remote           | Time (UTC)
      -----------------|------------------|-----------------------
      \`20260713000100\` | \`20260713000100\` | \`2026-07-13 00:01:00\`
      \`20260802131447\` | \` \`              | \`2026-08-02 13:14:47\`
    `)).toEqual(["20260802131447"]);
  });

  it("fails closed on remote-only or misaligned migration history", () => {
    expect(() => parseSupabaseMigrationList(
      "               | 20260805000000 | 2026-08-05",
    )).toThrow("MIGRATION_HISTORY_REMOTE_ONLY");
    expect(() => parseSupabaseMigrationList(
      "20260805000000 | 20260805000001 | 2026-08-05",
    )).toThrow("MIGRATION_HISTORY_DIVERGED");
    expect(() => parseSupabaseMigrationList(
      "` ` | `20260805000000` | `2026-08-05`",
    )).toThrow("MIGRATION_HISTORY_REMOTE_ONLY");
    expect(() => parseSupabaseMigrationList(
      "`20260805000000` | `20260805000001` | `2026-08-05`",
    )).toThrow("MIGRATION_HISTORY_DIVERGED");
    expect(() => parseSupabaseMigrationList(
      "`20260805000000 | `20260805000000` | `2026-08-05`",
    )).toThrow("MIGRATION_LIST_UNPARSEABLE");
    expect(() => parseSupabaseMigrationList(
      "`202608050000000` | `202608050000000` | `2026-08-05`",
    )).toThrow("MIGRATION_LIST_UNPARSEABLE");
    expect(() => parseSupabaseMigrationList(
      "202608050000000 | 202608050000000 | 2026-08-05",
    )).toThrow("MIGRATION_LIST_UNPARSEABLE");
    expect(() => parseSupabaseMigrationList(`
      \`20260805000000\` | \`20260805000000\` | \`2026-08-05\`
      \`20260805000001 | \` \` | \`2026-08-05\`
    `)).toThrow("MIGRATION_LIST_UNPARSEABLE");
    expect(() => parseSupabaseMigrationList(`
      \`20260805000000\` | \`20260805000000\` | \`2026-08-05\`
      | \`20260805000001 | \`2026-08-05\`
    `)).toThrow("MIGRATION_LIST_UNPARSEABLE");
    expect(() => parseSupabaseMigrationList(`
      \`20260805000000\` | \`20260805000000\` | \`2026-08-05\`
      \u200b\` \` | \`20260805000001\` | \`2026-08-05\`
    `)).toThrow("MIGRATION_LIST_UNPARSEABLE");
  });

  it("allows additive columns, paired constraints, and security on new tables", () => {
    expect(assertAdditiveMigrationSql(`
      set lock_timeout = '5s';
      set statement_timeout = '2min';
      alter table public.orders add column if not exists note text;
      create table public.order_notes (
        id uuid primary key,
        stall_id uuid not null
      );
      create table public.order_note_audits (id uuid primary key);
      alter table public.order_notes enable row level security;
      alter table public.order_notes force row level security;
      create trigger order_notes_touch before update on public.order_notes
        for each row execute function public.touch_order();
      create policy order_notes_read on public.order_notes
        as permissive for select to authenticated
        using (app_private.has_stall_role(
          stall_id,
          null::public.user_role[]
        ));
      revoke all on table public.order_notes, public.order_note_audits from anon;
      grant select (id) on table public.order_notes to authenticated;
      comment on column public.order_notes.id is 'Stable note identifier.';
    `)).toBe(true);
  });

  it("rejects grants on existing objects while allowing grants on objects created here", () => {
    expect(() => assertAdditiveMigrationSql(
      "grant select on table public.orders to authenticated;",
    )).toThrow("GRANT_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(
      "grant execute on function public.authorize_order(uuid) to authenticated;",
    )).toThrow("GRANT_EXISTING_OBJECT_FORBIDDEN");
    expect(assertAdditiveMigrationSql(`
      create table public.new_orders (
        id uuid primary key,
        stall_id uuid not null
      );
      alter table public.new_orders enable row level security;
      alter table public.new_orders force row level security;
      create policy new_orders_read on public.new_orders
        for select to authenticated
        using (app_private.has_stall_role(
          stall_id,
          null::public.user_role[]
        ));
      grant select (id) on table public.new_orders to authenticated;
      create function public.new_order_helper(p_order_id uuid)
        returns boolean language sql as $$ select true; $$;
      revoke all on function public.new_order_helper(uuid) from public;
      grant execute on function public.new_order_helper(uuid)
        to authenticated;
    `)).toBe(true);
  });

  it("rejects owner and RLS mutations on existing tables", () => {
    expect(() => assertAdditiveMigrationSql(
      "alter table public.orders owner to service_role;",
    )).toThrow("SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(
      "alter table public.orders enable row level security;",
    )).toThrow("SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(
      "alter table public.orders force row level security;",
    )).toThrow("SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(
      "alter table if exists public.orders owner to service_role;",
    )).toThrow("SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN");
    expect(assertAdditiveMigrationSql(`
      create table public.new_orders (id uuid primary key);
      alter table public.new_orders owner to service_role;
      alter table public.new_orders enable row level security;
      alter table public.new_orders force row level security;
    `)).toBe(true);
    expect(() => assertAdditiveMigrationSql(`
      create table public.new_orders (id uuid primary key);
      alter table public.new_orders owner to anon;
    `)).toThrow("TABLE_OWNER_UNSAFE");
  });

  it("rejects policies and triggers that mutate existing tables", () => {
    for (const sql of [
      "create policy orders_read on public.orders as permissive for select using (true);",
      "create policy orders_read on public.orders as restrictive for select using (true);",
      "create trigger orders_touch before update on public.orders for each row execute function public.touch_order();",
      "drop policy if exists orders_read on public.orders; create policy orders_read on public.orders for select using (true);",
      "drop trigger if exists orders_touch on public.orders; create trigger orders_touch before update on public.orders for each row execute function public.touch_order();",
    ]) {
      expect(() => assertAdditiveMigrationSql(sql)).toThrow(
        "SECURITY_MUTATION_EXISTING_OBJECT_FORBIDDEN",
      );
    }
    expect(assertAdditiveMigrationSql(`
      create table public.new_orders (id uuid primary key);
      create trigger new_orders_touch before update on public.new_orders
        for each row execute function public.touch_order();
      create policy new_orders_read on public.new_orders
        as permissive for select to authenticated
        using (app_private.has_stall_role(
          stall_id,
          null::public.user_role[]
        ));
    `)).toBe(true);
  });

  it("allows only the complete Phase 3 dormant hard-lock migration", () => {
    const migration = readFileSync(
      new URL(
        "../../supabase/migrations/20260813070000_phase_three_feature_flag_hard_lock.sql",
        import.meta.url,
      ),
      "utf8",
    );
    expect(assertAdditiveMigrationSql(migration)).toBe(true);
    expect(() => assertAdditiveMigrationSql(
      migration.replace(
        "resilience_feature_flags_phase_three_lock_guard",
        "different_guard",
      ),
    )).toThrow("MIGRATION_STATEMENT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(
      migration.replace("set default_enabled = false", "set default_enabled = true"),
    )).toThrow("MIGRATION_STATEMENT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(
      migration.replace(
        "on public.resilience_feature_flag_overrides",
        "on public.orders",
      ),
    )).toThrow("MIGRATION_STATEMENT_FORBIDDEN");
  });

  it("rejects public exposure even when the table is created in this migration", () => {
    expect(() => assertAdditiveMigrationSql(`
      create table public.new_orders (
        id uuid primary key,
        stall_id uuid not null
      );
      alter table public.new_orders enable row level security;
      create policy new_orders_public on public.new_orders
        as permissive for select to anon using (true);
      grant select on table public.new_orders to anon;
    `)).toThrow();
    expect(() => assertAdditiveMigrationSql(`
      create table public.new_orders (
        id uuid primary key,
        stall_id uuid not null
      );
      create policy new_orders_weak on public.new_orders
        for select to authenticated using (true);
    `)).toThrow("POLICY_SCOPE_UNPROVEN");
    expect(() => assertAdditiveMigrationSql(`
      create table public.new_orders (
        id uuid primary key,
        stall_id uuid not null
      );
      create policy new_orders_scoped on public.new_orders
        for select to authenticated
        using (app_private.has_stall_role(
          stall_id,
          null::public.user_role[]
        ));
      grant select on table public.new_orders to authenticated;
    `)).toThrow("TABLE_GRANT_EXPOSURE_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create table public.new_orders (
        id uuid primary key,
        stall_id uuid not null
      );
      create policy new_orders_scoped on public.new_orders
        for select to authenticated
        using (app_private.has_stall_role(
          stall_id,
          null::public.user_role[]
        ));
      grant select (id) on table public.new_orders to authenticated;
    `)).toThrow("TABLE_GRANT_EXPOSURE_FORBIDDEN");
  });

  it("rejects unproven create-or-replace security helpers", () => {
    expect(() => assertAdditiveMigrationSql(`
      create or replace function public.authorize_order(p_order_id uuid)
        returns boolean language sql security definer
        as $$ select true; $$;
    `)).toThrow("FUNCTION_REPLACEMENT_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create or replace function public.authorize_order(uuid)
        returns boolean language sql security definer
        as $$ select true; $$;
    `)).toThrow("FUNCTION_REPLACEMENT_EXISTING_OBJECT_FORBIDDEN");
    expect(assertAdditiveMigrationSql(`
      create function public.authorize_new_order(p_order_id uuid)
        returns boolean language sql security definer
        as $$ select true; $$;
      revoke all on function public.authorize_new_order(uuid) from public;
    `)).toBe(true);
    expect(assertAdditiveMigrationSql(`
      create function public.authorize_new_order(p_order_id uuid)
        returns boolean language sql security definer
        as $$ select true; $$;
      create or replace function public.authorize_new_order(p_order_id uuid)
        returns boolean language sql security definer
        as $$ select false; $$;
      revoke all on function public.authorize_new_order(uuid) from public;
    `)).toBe(true);
  });

  it("rejects recreation of signatures belonging to existing functions", () => {
    expect(() => assertAdditiveMigrationSql(`
      alter function public.calculate_order(uuid, text)
        rename to calculate_order_legacy;
      create or replace function public.calculate_order(
        p_order_id uuid,
        p_label text
      ) returns integer language sql as $$ select 1; $$;
      comment on function public.calculate_order(uuid, text) is
        'Backward-compatible wrapper.';
      revoke all on function public.calculate_order_legacy(uuid, text)
        from public;
    `)).toThrow("FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      alter function public.authorize_order(uuid)
        rename to authorize_order_legacy;
      create function public.authorize_order(p_order_id uuid)
        returns boolean language sql security definer
        as $$ select true; $$;
    `)).toThrow("FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      alter function public.calculate_order(uuid, text)
        rename to calculate_order_legacy;
      create or replace function public.calculate_order(
        p_order_id uuid
      ) returns integer language sql as $$ select 1; $$;
    `)).toThrow("FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create or replace function public.calculate_order(
        p_order_id uuid,
        p_label text
      ) returns integer language sql as $$ select 1; $$;
      alter function public.calculate_order(uuid, text)
        rename to calculate_order_legacy;
    `)).toThrow("FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create function public.new_order_helper(p_order_id uuid)
        returns integer language sql as $$ select 1; $$;
      revoke all on function public.new_order_helper(text) from public;
    `)).toThrow("REVOKE_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create function public.calculate_order(p_order_id uuid)
        returns integer language sql as $$ select 1; $$;
      alter function public."Calculate_Order"(uuid)
        rename to calculate_order_legacy;
    `)).toThrow("FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create function public.safe_helper()
        returns integer language sql as $$ select 1; $$;
      revoke all on function public.safe_helper(), public."Existing_Helper"()
        from public;
    `)).toThrow("REVOKE_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      revoke app_admin from authenticated;
    `)).toThrow("REVOKE_STATEMENT_UNPARSEABLE");
    expect(() => assertAdditiveMigrationSql(`
      create table public.safe_table (id uuid primary key);
      revoke all on table public."Safe_Table" from public;
    `)).toThrow("REVOKE_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create table public."Safe_Table" (id uuid primary key);
      revoke all on table public.safe_table from public;
    `)).toThrow("REVOKE_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create table if not exists public.orders (id uuid primary key);
      revoke all on table public.orders from authenticated;
    `)).toThrow("REVOKE_EXISTING_OBJECT_FORBIDDEN");
  });

  it("rejects relocation chains for existing functions", () => {
    expect(() => assertAdditiveMigrationSql(`
      alter function public.calculate_order(uuid, text)
        set schema app_private;
      alter function app_private.calculate_order(uuid, text)
        rename to calculate_order_legacy;
      revoke all on function app_private.calculate_order_legacy(uuid, text)
        from public, anon, authenticated, service_role;
      create or replace function public.calculate_order(
        p_order_id uuid,
        p_label text
      ) returns integer language sql as $$ select 1; $$;
    `)).toThrow("FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      alter function public.calculate_order(uuid, text)
        set schema app_private;
      alter function app_private.calculate_order(uuid, text)
        rename to calculate_order_legacy;
    `)).toThrow("FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      alter function public.calculate_order(uuid, text)
        set schema app_private;
      create or replace function public.calculate_order(
        p_order_id uuid
      ) returns integer language sql as $$ select 1; $$;
    `)).toThrow("FUNCTION_EXISTING_OBJECT_MUTATION_FORBIDDEN");
  });

  it("allows documentation only for tables and triggers created by the migration", () => {
    expect(assertAdditiveMigrationSql(`
      create table public.order_notes (id uuid primary key);
      create trigger order_notes_touch before update on public.order_notes
        for each row execute function public.touch_order();
      comment on table public.order_notes is 'Order note records.';
      comment on trigger order_notes_touch on public.order_notes is
        'Maintains the update timestamp.';
    `)).toBe(true);
    expect(() => assertAdditiveMigrationSql(
      "comment on table public.orders is 'Changed';",
    )).toThrow("COMMENT_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(
      "comment on trigger orders_touch on public.orders is 'Changed';",
    )).toThrow("COMMENT_EXISTING_OBJECT_FORBIDDEN");
  });

  it("allows only idempotent default-off resilience feature seeds", () => {
    expect(assertAdditiveMigrationSql(`
      insert into public.resilience_feature_flags (
        code, description, default_enabled, is_emergency
      ) values (
        'SAFE_FOUNDATION_ENABLED', 'Disabled until approval.', false, false
      ) on conflict (code) do nothing;
    `)).toBe(true);
    for (const sql of [
      `insert into public.resilience_feature_flags (
        code, description, default_enabled, is_emergency
      ) values ('UNSAFE_ENABLED', 'Unsafe.', true, false)
        on conflict (code) do nothing;`,
      `insert into public.resilience_feature_flags (
        code, description, default_enabled, is_emergency
      ) values ('UNSAFE_EMERGENCY', 'Unsafe.', false, true)
        on conflict (code) do nothing;`,
      `insert into public.resilience_feature_flags (
        code, description, default_enabled, is_emergency
      ) values ('UNSAFE_UPDATE', 'Unsafe.', false, false)
        on conflict (code) do update set default_enabled = true;`,
      "insert into public.orders (id) values ('00000000-0000-0000-0000-000000000000');",
    ]) {
      expect(() => assertAdditiveMigrationSql(sql)).toThrow();
    }
  });

  it("allows only the approved additive btree_gist extension install", () => {
    expect(assertAdditiveMigrationSql(
      "create extension if not exists btree_gist with schema extensions;",
    )).toBe(true);
    expect(() => assertAdditiveMigrationSql(
      "create extension if not exists http with schema extensions;",
    )).toThrow("EXTENSION_INSTALL_UNSAFE");
    expect(() => assertAdditiveMigrationSql(
      "create extension btree_gist with schema extensions;",
    )).toThrow("EXTENSION_INSTALL_UNSAFE");
  });

  it("rejects disabled timeouts and comments on untouched objects", () => {
    expect(() => assertAdditiveMigrationSql(
      "set statement_timeout = '0';",
    )).toThrow("TIMEOUT_STATEMENT_UNSAFE");
    expect(() => assertAdditiveMigrationSql(
      "set lock_timeout = '0ms';",
    )).toThrow("TIMEOUT_STATEMENT_UNSAFE");
    expect(() => assertAdditiveMigrationSql(
      "comment on column public.orders.id is 'changed';",
    )).toThrow("COMMENT_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(
      "comment on function public.get_order(uuid) is 'changed';",
    )).toThrow("COMMENT_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      revoke all on table public.future_table from authenticated;
      create table if not exists public.future_table (id uuid primary key);
    `)).toThrow("REVOKE_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      revoke all on function public.future_helper() from authenticated;
      create or replace function public.future_helper()
        returns integer language sql as $$ select 1; $$;
    `)).toThrow("REVOKE_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      comment on column public.orders.future_column is 'changed';
      alter table public.orders add column future_column text;
    `)).toThrow("COMMENT_EXISTING_OBJECT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create table if not exists public.orders (id uuid primary key);
      comment on column public.orders.id is 'changed';
    `)).toThrow("COMMENT_EXISTING_OBJECT_FORBIDDEN");
  });

  it.each([
    `drop index if exists "Orders_Index"; create index orders_index on public.orders(id);`,
    `alter table public.orders drop constraint if exists "Orders_Check", add constraint orders_check check (id is not null);`,
    `drop trigger if exists "Orders_Touch" on public.orders; create trigger orders_touch before update on public.orders for each row execute function public.touch_order();`,
    `drop policy if exists "Orders_Read" on public.orders; create policy orders_read on public.orders for select using (true);`,
  ])("does not pair quoted mixed-case and unquoted replacement objects: %s", (sql) => {
    expect(() => assertAdditiveMigrationSql(sql)).toThrow(
      "UNPAIRED_OBJECT_DROP_FORBIDDEN",
    );
  });

  it.each([
    "drop table public.orders;",
    "delete from public.orders;",
    "alter table public.orders drop column note;",
    "alter table public.orders rename column note to memo;",
    "alter table public.orders alter column note set not null;",
    "drop trigger if exists orders_touch on public.orders;",
    "revoke all on table public.orders from anon;",
    "do $$ begin execute 'drop table public.orders'; end $$;",
    "create index if not exists idx_orders on public.orders(id); drop index if exists idx_orders;",
    "select public.erase_all_orders();",
    "do $$ begin perform public.erase_all_orders(); end $$;",
    "call public.erase_all_orders();",
    "drop index if exists idx_a, idx_unpaired; create index idx_a on public.orders(id);",
    "drop index if exists idx_a cascade; create index idx_a on public.orders(id);",
  ])("rejects destructive or unpaired SQL: %s", (sql) => {
    expect(() => assertAdditiveMigrationSql(sql)).toThrow();
  });

  it.each([
    "alter table public.orders alter column organization_id set default gen_random_uuid();",
    "alter table public.orders replica identity nothing;",
    "alter table public.orders disable rule orders_guard;",
    "alter table public.orders set (autovacuum_enabled = false);",
    "alter table public.orders attach partition public.orders_2026 for values from (1) to (2);",
    "alter table public.orders detach partition public.orders_2025;",
    "alter table public.orders add column note text, replica identity nothing;",
  ])("rejects unclassified ALTER TABLE actions: %s", (sql) => {
    expect(() => assertAdditiveMigrationSql(sql)).toThrow(
      "ALTER_TABLE_ACTION_FORBIDDEN",
    );
  });

  it("rejects destructive DO blocks even when comments split DO and its body", () => {
    for (const sql of [
      "do /* misleading */ $$ begin execute 'drop table public.orders'; end $$;",
      "do -- misleading\n$$ begin execute 'drop table public.orders'; end $$;",
    ]) {
      expect(() => assertAdditiveMigrationSql(sql)).toThrow(
        "DESTRUCTIVE_DO_BLOCK_FORBIDDEN",
      );
    }
  });

  it("requires every created function to revoke PUBLIC explicitly", () => {
    expect(() => assertAdditiveMigrationSql(`
      create function public.unsafe_helper()
        returns integer language sql security definer as $$ select 1; $$;
    `)).toThrow("FUNCTION_PUBLIC_REVOKE_REQUIRED");
    expect(() => assertAdditiveMigrationSql(`
      create function public.unsafe_helper()
        returns integer language sql as $$ select 1; $$;
    `)).toThrow("FUNCTION_PUBLIC_REVOKE_REQUIRED");
    expect(() => assertAdditiveMigrationSql(`
      create function public.unnamed_helper(uuid)
        returns integer language sql as $$ select 1; $$;
      revoke all on function public.unnamed_helper(uuid) from public;
    `)).toThrow("FUNCTION_DECLARATION_UNPARSEABLE");
    expect(assertAdditiveMigrationSql(`
      create function public.safe_helper()
        returns integer language sql security definer as $$ select 1; $$;
      revoke all on function public.safe_helper() from public;
    `)).toBe(true);
  });

  it("rejects replacement of constraints and indexes on existing objects", () => {
    expect(() => assertAdditiveMigrationSql(`
      alter table public.orders
        drop constraint if exists orders_note_check,
        add constraint orders_note_check check (true);
    `)).toThrow("EXISTING_OBJECT_REPLACEMENT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      drop index if exists orders_lookup;
      create index orders_lookup on public.other_orders(id);
    `)).toThrow("EXISTING_OBJECT_REPLACEMENT_FORBIDDEN");
    expect(assertAdditiveMigrationSql(`
      create table public.new_orders (id uuid primary key, note text);
      alter table public.new_orders
        drop constraint if exists new_orders_note_check,
        add constraint new_orders_note_check check (note is null);
      create index new_orders_lookup on public.new_orders(id);
      drop index new_orders_lookup;
      create index new_orders_lookup on public.new_orders(id);
    `)).toBe(true);
    expect(assertAdditiveMigrationSql(`
      alter table public.orders
        add constraint orders_new_note_check check (note is null);
      alter table public.orders
        drop constraint orders_new_note_check,
        add constraint orders_new_note_check check (note is not null);
      create index orders_new_lookup on public.orders(id);
      drop index orders_new_lookup;
      create index orders_new_lookup on public.orders(id);
    `)).toBe(true);
    expect(() => assertAdditiveMigrationSql(`
      create index if not exists orders_lookup on public.orders(id);
      drop index orders_lookup;
      create index orders_lookup on public.orders(id);
    `)).toThrow("EXISTING_OBJECT_REPLACEMENT_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create index new_lookup on public.orders(id);
      drop index new_lookup;
      create index new_lookup on public.other_orders(id);
    `)).toThrow("INDEX_REPLACEMENT_RETARGET_FORBIDDEN");
  });

  it("preserves statement boundaries around apostrophes in quoted identifiers", () => {
    expect(() => assertAdditiveMigrationSql(`
      create table public."safe'one" (id integer);
      drop table public.orders;
      create table public."two'three" (id integer);
    `)).toThrow();
    expect(assertAdditiveMigrationSql(`
      create table public."safe'one" (id integer);
      create table public."two""three" (id integer);
    `)).toBe(true);
    expect(() => assertAdditiveMigrationSql(
      'create table public."unterminated (id integer);',
    )).toThrow("MIGRATION_SQL_QUOTED_IDENTIFIER_INVALID");
  });

  it.each([
    "insert into public.plan_entitlements (feature_code) values ('PRINTER_INTEGRATION');",
    "update public.plan_entitlements set is_enabled = true;",
    "insert into public.plan_entitlements (feature_code) values ('PRINTER_INTEGRATION') on conflict (feature_code) do update set is_enabled = true;",
  ])("rejects replicated-table DML from additive DR schema plans: %s", (sql) => {
    expect(() => assertAdditiveMigrationSql(sql)).toThrow();
  });

  it("rejects arbitrary tagged procedural blocks from additive DR schema plans", () => {
    expect(() => assertAdditiveMigrationSql(`
      do $migration$
      begin
        raise exception 'blocked';
      end
      $migration$;
    `)).toThrow("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
  });

  it("binds the exact pending filenames and contents into the immutable plan", () => {
    const plan = createAdditiveMigrationPlan({
      migrationList: `
        LOCAL          | REMOTE         | TIME (UTC)
        \`20260805000000\` | \`20260805000000\` | \`2026-08-05\`
        \`20260805000001\` | \` \`              | \`2026-08-05\`
      `,
      migrationFiles: [
        { file: "20260805000000_existing.sql", content: "select 1;" },
        {
          file: "20260805000001_add_note.sql",
          content: "alter table public.orders add column note text;",
        },
      ],
    });

    expect(plan).toMatchObject({
      strategy: "ADDITIVE_ONLY",
      migrations: [{
        version: "20260805000001",
        file: "20260805000001_add_note.sql",
        contentDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
      }],
      planDigest: expect.stringMatching(/^[0-9a-f]{64}$/u),
    });
  });

  it("allows a bounded fail-closed duplicate audit inside an additive migration", () => {
    expect(assertAdditiveMigrationSql(`
      begin;
      set local lock_timeout = '5s';
      set local statement_timeout = '2min';
      lock table public.stalls in share row exclusive mode;
      do $migration$
      declare
        collision_code text;
      begin
        select pg_catalog.lower(stall.code)
          into collision_code
        from public.stalls stall
        group by pg_catalog.lower(stall.code)
        having pg_catalog.count(*) > 1
        order by pg_catalog.lower(stall.code)
        limit 1;

        if found then
          raise unique_violation using
            message = 'GLOBAL_STALL_CODE_COLLISION',
            detail = pg_catalog.format(
              'normalized code %L already exists more than once',
              collision_code
            ),
            constraint = 'stalls_code_lower_guard';
        end if;
      end;
      $migration$;
      commit;
    `)).toBe(true);
  });

  it("allows additive SQL followed by a trailing line comment", () => {
    expect(assertAdditiveMigrationSql(
      "create table public.parser_probe (id uuid); -- trailing comment",
    )).toBe(true);
  });

  it("allows the bounded report delivery scheduler repair", () => {
    expect(assertAdditiveMigrationSql(reportDeliverySchedulerMigration)).toBe(true);
  });

  it("rejects a scheduler repair for any other cron job", () => {
    expect(() => assertAdditiveMigrationSql(
      reportDeliverySchedulerMigration.replaceAll(
        "stallorder-report-deliveries",
        "unreviewed-job",
      ),
    )).toThrow("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
  });

  it("rejects a scheduler repair with a modified function body", () => {
    expect(() => assertAdditiveMigrationSql(
      reportDeliverySchedulerMigration.replace(
        "return v_request_id;",
        "return 0;",
      ),
    )).toThrow("DESTRUCTIVE_DO_BLOCK_FORBIDDEN");
  });

  it.each([
    "begin; create table public.parser_probe (id uuid);",
    "create table public.parser_probe (id uuid); commit;",
  ])("rejects an incomplete explicit transaction wrapper", (sql) => {
    expect(() => assertAdditiveMigrationSql(sql)).toThrow(
      "TRANSACTION_WRAPPER_UNSAFE",
    );
  });

  it.each([
    ["missing transaction wrapper", `
      set local lock_timeout = '5s';
      set local statement_timeout = '2min';
      lock table public.stalls in share row exclusive mode;
      do $migration$
      declare
        collision_code text;
      begin
        select pg_catalog.lower(stall.code) into collision_code
        from public.stalls stall
        group by pg_catalog.lower(stall.code)
        having pg_catalog.count(*) > 1
        order by pg_catalog.lower(stall.code)
        limit 1;
        if found then
          raise unique_violation using
            message = 'GLOBAL_STALL_CODE_COLLISION',
            detail = pg_catalog.format('normalized code %L already exists more than once', collision_code),
            constraint = 'stalls_code_lower_guard';
        end if;
      end;
      $migration$;
    `],
    ["missing lock", `
      set local lock_timeout = '5s';
      set local statement_timeout = '2min';
      do $migration$
      declare
        collision_code text;
      begin
        select pg_catalog.lower(stall.code) into collision_code
        from public.stalls stall
        group by pg_catalog.lower(stall.code)
        having pg_catalog.count(*) > 1
        order by pg_catalog.lower(stall.code)
        limit 1;
        if found then
          raise unique_violation using
            message = 'GLOBAL_STALL_CODE_COLLISION',
            detail = pg_catalog.format('normalized code %L already exists more than once', collision_code),
            constraint = 'stalls_code_lower_guard';
        end if;
      end;
      $migration$;
    `],
    ["wrong table", `
      set local lock_timeout = '5s';
      set local statement_timeout = '2min';
      lock table public.orders in share row exclusive mode;
      do $migration$
      declare
        collision_code text;
      begin
        select pg_catalog.lower(stall.code) into collision_code
        from public.stalls stall
        group by pg_catalog.lower(stall.code)
        having pg_catalog.count(*) > 1
        order by pg_catalog.lower(stall.code)
        limit 1;
        if found then
          raise unique_violation using
            message = 'GLOBAL_STALL_CODE_COLLISION',
            detail = pg_catalog.format('normalized code %L already exists more than once', collision_code),
            constraint = 'stalls_code_lower_guard';
        end if;
      end;
      $migration$;
    `],
    ["data mutation", `
      set local lock_timeout = '5s';
      set local statement_timeout = '2min';
      lock table public.stalls in share row exclusive mode;
      do $migration$
      begin
        update public.stalls set code = code;
      end;
      $migration$;
    `],
    ["comment-hidden data mutation", `
      set local lock_timeout = '5s';
      set local statement_timeout = '2min';
      lock table public.stalls in share row exclusive mode;
      do /* validator gap */ $hidden$
      begin
        update public.stalls set code = code;
      end;
      $hidden$;
      do $migration$
      declare
        collision_code text;
      begin
        select pg_catalog.lower(stall.code) into collision_code
        from public.stalls stall
        group by pg_catalog.lower(stall.code)
        having pg_catalog.count(*) > 1
        order by pg_catalog.lower(stall.code)
        limit 1;
        if found then
          raise unique_violation using
            message = 'GLOBAL_STALL_CODE_COLLISION',
            detail = pg_catalog.format('normalized code %L already exists more than once', collision_code),
            constraint = 'stalls_code_lower_guard';
        end if;
      end;
      $migration$;
    `],
  ])("rejects an unsafe duplicate audit: %s", (_name, sql) => {
    expect(() => assertAdditiveMigrationSql(sql)).toThrow(
      "DESTRUCTIVE_DO_BLOCK_FORBIDDEN",
    );
  });

  it("fails when CLI output omits a repository migration", () => {
    expect(() => createAdditiveMigrationPlan({
      migrationList: "20260805000000 | 20260805000000 | 2026-08-05",
      migrationFiles: [
        { file: "20260805000000_existing.sql", content: "select 1;" },
        { file: "20260805000001_hidden.sql", content: "drop table public.orders;" },
      ],
    })).toThrow("MIGRATION_LIST_LOCAL_FILES_MISMATCH");
  });
});
