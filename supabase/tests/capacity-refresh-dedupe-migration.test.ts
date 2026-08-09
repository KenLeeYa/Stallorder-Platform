import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const baselineSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260720135841_capacity_wait_time.sql",
  import.meta.url,
)), "utf8");
const migrationSource = readFileSync(fileURLToPath(new URL(
  "../migrations/20260809161446_dedupe_stall_capacity_refresh.sql",
  import.meta.url,
)), "utf8");

function normalizeLineEndings(value: string) {
  return value.replace(/\r\n/g, "\n");
}

function extractRefreshFunction(source: string) {
  const normalized = normalizeLineEndings(source);
  const start = normalized.indexOf(
    "create or replace function public.refresh_stall_capacity(",
  );
  const end = normalized.indexOf("\n$$;", start);
  if (start < 0 || end < 0) throw new Error("REFRESH_STALL_CAPACITY_FUNCTION_NOT_FOUND");
  return normalized.slice(start, end + 4);
}

describe("refresh_stall_capacity dedupe migration", () => {
  it("changes only the no-action return path in the effective function", () => {
    const baselineFunction = extractRefreshFunction(baselineSource);
    const migratedFunction = extractRefreshFunction(migrationSource);
    const expectedFunction = baselineFunction.replace(
      "  return public.calculate_stall_capacity(p_stall_id, '[]'::jsonb);\nend;\n$$;",
      () => [
        "  if v_action is null then",
        "    return v_snapshot;",
        "  end if;",
        "",
        "  return public.calculate_stall_capacity(p_stall_id, '[]'::jsonb);",
        "end;",
        "$$;",
      ].join("\n"),
    );

    expect(expectedFunction).not.toBe(baselineFunction);
    expect(migratedFunction).toBe(expectedFunction);
  });

  it("keeps one initial calculation and one conditional post-action calculation", () => {
    const migratedFunction = extractRefreshFunction(migrationSource);
    expect(migratedFunction.match(/public\.calculate_stall_capacity/g)).toHaveLength(2);
    expect(migratedFunction).toContain([
      "  if v_action is null then",
      "    return v_snapshot;",
      "  end if;",
      "",
      "  return public.calculate_stall_capacity(p_stall_id, '[]'::jsonb);",
    ].join("\n"));
  });

  it("retains the trusted RPC privileges", () => {
    const normalized = normalizeLineEndings(migrationSource);
    expect(normalized).toContain([
      "revoke all on function public.refresh_stall_capacity(uuid, boolean, text)",
      "from public, anon, authenticated;",
    ].join("\n"));
    expect(normalized).toContain([
      "grant execute on function public.refresh_stall_capacity(uuid, boolean, text)",
      "to service_role;",
    ].join("\n"));
  });
});
