import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const migrationSource = readFileSync(
  fileURLToPath(new URL(
    "../migrations/20260823170000_non_kds_confirmation_printing.sql",
    import.meta.url,
  )),
  "utf8",
);

describe("non-KDS confirmation printing migration", () => {
  it("keeps confirmation printing enabled independently of KDS", () => {
    expect(migrationSource).toContain(
      "create or replace function public.queue_confirmed_order_print_job()",
    );
    expect(migrationSource).toContain("and settings.print_module_enabled");
    expect(migrationSource).not.toContain("settings.kds_module_enabled");
    expect(migrationSource).toContain("on conflict do nothing");
  });
});
