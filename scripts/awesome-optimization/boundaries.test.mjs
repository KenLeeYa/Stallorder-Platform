import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { expect, test } from "vitest";
import { scanBoundaries } from "./boundaries.mjs";

test("runtime transitive server imports, public secrets and vendor collection are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "awesome-boundary-"));
  try {
    mkdirSync(join(root, "src"));
    writeFileSync(join(root, "src/client.ts"), '"use client"; import "./hidden"; process.env.NEXT_PUBLIC_ACCESS_TOKEN;');
    writeFileSync(join(root, "src/hidden.ts"), 'import "server-only"; import "posthog-js";');
    expect(scanBoundaries(root).findings.map((finding) => finding.classification).sort()).toEqual(["PUBLIC_SECRET_PREFIX", "SECRET_ENV_IN_CLIENT", "SERVER_DEPENDENCY_IN_CLIENT", "UNAPPROVED_VENDOR_COLLECTION"].sort());
    writeFileSync(join(root, "src/client.ts"), '"use client"; import type { Hidden } from "./hidden";');
    expect(scanBoundaries(root).findings).toEqual([]);
  } finally { rmSync(root, { recursive: true }); }
});

test("an exact baseline debt does not authorize a changed server-containing source", () => {
  const root = mkdtempSync(join(tmpdir(), "awesome-baseline-boundary-"));
  try {
    mkdirSync(join(root, "src"));
    mkdirSync(join(root, "scripts/awesome-optimization"), { recursive: true });
    const original = '"use client"; import "server-only";';
    writeFileSync(join(root, "src/client.ts"), original);
    writeFileSync(join(root, "scripts/awesome-optimization/boundary-baseline.json"), JSON.stringify([
      { entry: "src/client.ts", path: "src/client.ts", classification: "SERVER_DEPENDENCY_IN_CLIENT", sourceHashes: { "src/client.ts": createHash("sha256").update(original).digest("hex") } },
    ]));
    expect(scanBoundaries(root).baselineDebt).toHaveLength(1);
    writeFileSync(join(root, "src/client.ts"), original + '\nimport "@prisma/client";');
    expect(scanBoundaries(root).baselineDebt).toEqual([]);
    expect(scanBoundaries(root).findings).toHaveLength(2);
  } finally { rmSync(root, { recursive: true }); }
});

test("native contracts cannot use server actions as a dependency escape", () => {
  const root = mkdtempSync(join(tmpdir(), "awesome-native-boundary-"));
  try {
    mkdirSync(join(root, "apps/mobile"), { recursive: true });
    writeFileSync(join(root, "apps/mobile/index.ts"), 'import "./action";');
    writeFileSync(join(root, "apps/mobile/action.ts"), '"use server"; import "@prisma/client";');
    expect(scanBoundaries(root).findings).toEqual([
      { entry: "apps/mobile/action.ts", path: "apps/mobile/action.ts", classification: "SERVER_DEPENDENCY_IN_CLIENT" },
      { entry: "apps/mobile/index.ts", path: "apps/mobile/action.ts", classification: "SERVER_DEPENDENCY_IN_CLIENT" },
    ]);
  } finally { rmSync(root, { recursive: true }); }
});

test("Expo build configuration stays server-owned but runtime imports of plugins are rejected", () => {
  const root = mkdtempSync(join(tmpdir(), "awesome-expo-boundary-"));
  try {
    mkdirSync(join(root, "apps/mobile/plugins"), { recursive: true });
    writeFileSync(join(root, "apps/mobile/app.config.ts"), 'import "./plugins/local-loopback.cjs";');
    writeFileSync(join(root, "apps/mobile/plugins/local-loopback.cjs"), 'require("node:fs"); process.env.BUILD_ACCESS_TOKEN;');
    writeFileSync(join(root, "apps/mobile/index.ts"), 'export const ready = true;');
    expect(scanBoundaries(root).findings).toEqual([]);
    writeFileSync(join(root, "apps/mobile/index.ts"), 'import "./plugins/local-loopback.cjs";');
    expect(scanBoundaries(root).findings).toEqual([
      { entry: "apps/mobile/index.ts", path: "apps/mobile/plugins/local-loopback.cjs", classification: "SERVER_DEPENDENCY_IN_CLIENT" },
      { entry: "apps/mobile/index.ts", path: "apps/mobile/plugins/local-loopback.cjs", classification: "SECRET_ENV_IN_CLIENT" },
    ]);
    writeFileSync(join(root, "apps/mobile/index.ts"), 'import "./app.config";');
    expect(scanBoundaries(root).findings).toHaveLength(2);
  } finally { rmSync(root, { recursive: true }); }
});
