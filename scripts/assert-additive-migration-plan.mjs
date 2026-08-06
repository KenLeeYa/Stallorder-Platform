import { readFile, readdir } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  AdditiveMigrationPlanError,
  createAdditiveMigrationPlan,
} from "./lib/additive-migration-plan.mjs";

try {
  const migrationListPath = argumentValue("--migration-list");
  const migrationDirectory = resolve("supabase/migrations");
  const files = (await readdir(migrationDirectory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map(async (entry) => ({
      file: basename(entry.name),
      content: await readFile(resolve(migrationDirectory, entry.name), "utf8"),
    }));
  const plan = createAdditiveMigrationPlan({
    migrationList: await readFile(resolve(migrationListPath), "utf8"),
    migrationFiles: await Promise.all(files),
  });
  console.log(JSON.stringify(plan, null, 2));
} catch (error) {
  const reason = error instanceof AdditiveMigrationPlanError
    ? error.code
    : error instanceof Error && /^[A-Z0-9_]+$/u.test(error.message)
      ? error.message
      : "ADDITIVE_MIGRATION_PLAN_FAILED";
  console.error(JSON.stringify({
    event: "additive_migration_plan_failed",
    reason,
  }));
  process.exitCode = 1;
}

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : null;
  if (!value || /[\r\n]/u.test(value)) throw new Error("MIGRATION_LIST_PATH_INVALID");
  return value;
}
