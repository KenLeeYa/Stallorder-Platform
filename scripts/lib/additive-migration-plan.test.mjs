import { describe, expect, it } from "vitest";
import {
  assertAdditiveMigrationSql,
  createAdditiveMigrationPlan,
  parseSupabaseMigrationList,
} from "./additive-migration-plan.mjs";

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

  it("allows additive columns and transactionally paired object replacements", () => {
    expect(assertAdditiveMigrationSql(`
      set lock_timeout = '5s';
      set statement_timeout = '2min';
      alter table public.orders add column if not exists note text;
      alter table public.orders
        drop constraint if exists orders_note_check,
        add constraint orders_note_check check (note is null or note <> '');
      drop trigger if exists orders_touch on public.orders;
      create trigger orders_touch before update on public.orders
        for each row execute function public.touch_order();
      drop policy if exists orders_read on public.orders;
      create policy orders_read on public.orders for select using (true);
      create table public.order_notes (id uuid primary key);
      create table public.order_note_audits (id uuid primary key);
      revoke all on table public.order_notes, public.order_note_audits from anon;
      comment on column public.order_notes.id is 'Stable note identifier.';
    `)).toBe(true);
  });

  it("allows a function rename only when the original signature is recreated", () => {
    expect(assertAdditiveMigrationSql(`
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
    `)).toBe(true);
    expect(() => assertAdditiveMigrationSql(`
      alter function public.calculate_order(uuid, text)
        rename to calculate_order_legacy;
      create or replace function public.calculate_order(
        p_order_id uuid
      ) returns integer language sql as $$ select 1; $$;
    `)).toThrow("UNPAIRED_FUNCTION_RENAME_FORBIDDEN");
    expect(() => assertAdditiveMigrationSql(`
      create or replace function public.calculate_order(
        p_order_id uuid,
        p_label text
      ) returns integer language sql as $$ select 1; $$;
      alter function public.calculate_order(uuid, text)
        rename to calculate_order_legacy;
    `)).toThrow("UNPAIRED_FUNCTION_RENAME_FORBIDDEN");
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
    `)).toThrow("MIGRATION_STATEMENT_FORBIDDEN");
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
    "insert into public.plan_entitlements (feature_code) values ('PRINTER_INTEGRATION');",
    "update public.plan_entitlements set is_enabled = true;",
    "insert into public.plan_entitlements (feature_code) values ('PRINTER_INTEGRATION') on conflict (feature_code) do update set is_enabled = true;",
  ])("rejects replicated-table DML from additive DR schema plans: %s", (sql) => {
    expect(() => assertAdditiveMigrationSql(sql)).toThrow("MIGRATION_STATEMENT_FORBIDDEN");
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
