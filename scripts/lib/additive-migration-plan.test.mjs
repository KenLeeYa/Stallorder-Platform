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
  });

  it("fails closed on remote-only or misaligned migration history", () => {
    expect(() => parseSupabaseMigrationList(
      "               | 20260805000000 | 2026-08-05",
    )).toThrow("MIGRATION_HISTORY_REMOTE_ONLY");
    expect(() => parseSupabaseMigrationList(
      "20260805000000 | 20260805000001 | 2026-08-05",
    )).toThrow("MIGRATION_HISTORY_DIVERGED");
  });

  it("allows additive columns and transactionally paired object replacements", () => {
    expect(assertAdditiveMigrationSql(`
      alter table public.orders add column if not exists note text;
      alter table public.orders
        drop constraint if exists orders_note_check,
        add constraint orders_note_check check (note is null or note <> '');
      drop trigger if exists orders_touch on public.orders;
      create trigger orders_touch before update on public.orders
        for each row execute function public.touch_order();
      drop policy if exists orders_read on public.orders;
      create policy orders_read on public.orders for select using (true);
      create table if not exists public.order_notes (id uuid primary key);
      revoke all on table public.order_notes from anon;
    `)).toBe(true);
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

  it("binds the exact pending filenames and contents into the immutable plan", () => {
    const plan = createAdditiveMigrationPlan({
      migrationList: `
        LOCAL          | REMOTE         | TIME (UTC)
        20260805000000 | 20260805000000 | 2026-08-05
        20260805000001 |                | 2026-08-05
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
