import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const operatingModeMigration = readFileSync(join(
  process.cwd(),
  "supabase/migrations/20260829150000_organization_operating_mode.sql",
), "utf8");
const einvoiceMigration = readFileSync(join(
  process.cwd(),
  "supabase/migrations/20260830010000_multitenant_einvoice_local_mock.sql",
), "utf8");

describe("pending release migration DR fencing", () => {
  it("suspends the organizations write guard only around the reviewed backfill", () => {
    expectScopedWriteGuard(
      operatingModeMigration,
      "organizations",
      /update public\.organizations/iu,
    );
  });

  it("suspends the billing feature flag write guard only around the default-off seed", () => {
    expectScopedWriteGuard(
      einvoiceMigration,
      "billing_feature_flags",
      /insert into public\.billing_feature_flags/iu,
    );
  });
});

function expectScopedWriteGuard(
  migration: string,
  table: string,
  mutation: RegExp,
) {
  const begin = migration.search(/^begin;$/imu);
  const disable = migration.search(new RegExp(
    `^alter table public\\.${table} disable trigger backend_writable_guard;$`,
    "imu",
  ));
  const write = migration.search(mutation);
  const enable = migration.search(new RegExp(
    `^alter table public\\.${table} enable trigger backend_writable_guard;$`,
    "imu",
  ));
  const commit = migration.search(/^commit;$/imu);

  expect(begin).toBeGreaterThanOrEqual(0);
  expect(migration).toMatch(/^set local lock_timeout = '5s';$/imu);
  expect(migration).toMatch(/^set local statement_timeout = '2min';$/imu);
  expect(disable).toBeGreaterThan(begin);
  expect(write).toBeGreaterThan(disable);
  expect(enable).toBeGreaterThan(write);
  expect(commit).toBeGreaterThan(enable);
  expect(migration.match(new RegExp(
    `^alter table public\\.${table} disable trigger backend_writable_guard;$`,
    "gimu",
  ))).toHaveLength(1);
  expect(migration.match(new RegExp(
    `^alter table public\\.${table} enable trigger backend_writable_guard;$`,
    "gimu",
  ))).toHaveLength(1);
}
