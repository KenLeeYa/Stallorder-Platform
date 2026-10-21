import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { sourceFiles } from "./boundaries.mjs";

// Effective nonsecret inputs plus repository-owned scripts cover the check entrypoints,
// their imported guards/helpers and workflow-contract read fixtures. Never traverse .env files.
export const effectiveConfigs = ["package.json", "package-lock.json", "next.config.ts", "tsconfig.json", "eslint.config.mjs",
  "playwright.config.ts", "playwright.responsive.config.ts", "vitest.config.ts", "prisma/schema.prisma", "supabase/config.toml",
  "vercel.json", "vercel.dr.json", "node_modules/vitest/vitest.mjs", "node_modules/typescript/bin/tsc", "node_modules/eslint/bin/eslint.js"];

export function sourceInputs(root) {
  const paths = [...effectiveConfigs, ...["src", "scripts", "apps/mobile", "packages", "supabase/migrations", "e2e", ".github/workflows"].flatMap((path) => sourceFiles(root, path, true))];
  const inputs = [...new Set(paths)].sort().map((path) => ({ path, sha256: existsSync(join(root, path)) ? createHash("sha256").update(readFileSync(join(root, path))).digest("hex") : null }));
  return { sourceSha256: createHash("sha256").update(inputs.map(({ path, sha256 }) => `${path}\0${sha256 ?? "MISSING"}`).join("\n")).digest("hex"), inputs };
}
