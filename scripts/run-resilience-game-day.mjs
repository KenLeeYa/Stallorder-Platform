import {
  GameDayError,
  buildGameDayPlan,
  runDrDryRunDrill,
} from "./lib/resilience-game-day.mjs";

function optionValues(name, argv) {
  return argv.flatMap((value, index) => value === name ? [argv[index + 1] ?? ""] : []);
}

const argv = process.argv.slice(2);

try {
  if (argv.includes("--apply")) throw new GameDayError("GAME_DAY_APPLY_NOT_SUPPORTED");
  const scenarioIds = optionValues("--scenario", argv)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
  const plan = buildGameDayPlan({ scenarioIds });
  const drDryRunReceipts = argv.includes("--verify-dry-runs")
    ? runDrDryRunDrill()
    : [];

  console.log(JSON.stringify({
    ...plan,
    drDryRunReceipts,
    nextAction: argv.includes("--verify-dry-runs")
      ? "執行文件指定的 Local/Ephemeral 自動化測試並保存測試摘要。"
      : "加上 --verify-dry-runs 驗證 DR 與 failback 腳本契約。",
  }, null, 2));
} catch (error) {
  console.error(JSON.stringify({
    event: "resilience_game_day_failed",
    reason: error instanceof GameDayError ? error.code : "GAME_DAY_FAILED",
  }));
  process.exitCode = 1;
}
