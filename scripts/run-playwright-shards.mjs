import { spawnSync } from "node:child_process";
import { rmSync } from "node:fs";
import { delimiter, resolve } from "node:path";

const shardCount = Number.parseInt(process.env.PLAYWRIGHT_SHARD_COUNT ?? "8", 10);
if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 32) {
  throw new Error("PLAYWRIGHT_SHARD_COUNT_INVALID");
}

const playwrightCli = resolve("node_modules", "playwright", "cli.js");
const localBin = resolve("node_modules", ".bin");
const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
const failedShards = [];

for (let shard = 1; shard <= shardCount; shard += 1) {
  const trustedClientIp = `203.0.113.${20 + shard}`;
  console.log(`Running Playwright shard ${shard}/${shardCount} with isolated client IP ${trustedClientIp}`);
  rmSync(resolve(".next", "dev"), { recursive: true, force: true });

  const result = spawnSync(
    process.execPath,
    [playwrightCli, "test", `--shard=${shard}/${shardCount}`, `--output=test-results/shard-${shard}`],
    {
      env: {
        ...process.env,
        [pathKey]: `${localBin}${delimiter}${process.env[pathKey] ?? ""}`,
        PLAYWRIGHT_TRUSTED_CLIENT_IP: trustedClientIp,
        PLAYWRIGHT_HTML_OUTPUT_DIR: resolve("playwright-report", `shard-${shard}`),
      },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) failedShards.push(shard);
}

if (failedShards.length > 0) console.error(`Failed Playwright shards: ${failedShards.join(", ")}`);
process.exitCode = failedShards.length > 0 ? 1 : 0;
