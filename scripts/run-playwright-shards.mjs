import { spawnSync } from "node:child_process";

const shardCount = Number.parseInt(process.env.PLAYWRIGHT_SHARD_COUNT ?? "8", 10);
if (!Number.isSafeInteger(shardCount) || shardCount < 1 || shardCount > 32) {
  throw new Error("PLAYWRIGHT_SHARD_COUNT_INVALID");
}

const npxCommand = process.platform === "win32" ? "npx.cmd" : "npx";

for (let shard = 1; shard <= shardCount; shard += 1) {
  const trustedClientIp = `203.0.113.${20 + shard}`;
  console.log(`Running Playwright shard ${shard}/${shardCount} with isolated client IP ${trustedClientIp}`);

  const result = spawnSync(
    npxCommand,
    ["playwright", "test", `--shard=${shard}/${shardCount}`],
    {
      env: {
        ...process.env,
        PLAYWRIGHT_TRUSTED_CLIENT_IP: trustedClientIp,
      },
      stdio: "inherit",
    },
  );

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}
