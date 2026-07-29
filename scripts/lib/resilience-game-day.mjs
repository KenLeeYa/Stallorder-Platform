import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export const failureInjectionScenarios = Object.freeze([
  {
    id: "REALTIME_UNAVAILABLE",
    expected: "Staff 顯示 SSE 或 5 秒輪詢，並重新讀取權威訂單資料",
    automatedEvidence: ["e2e/resilience-failure-injection.spec.ts"],
  },
  {
    id: "SSE_UNAVAILABLE",
    expected: "Staff 切換 Realtime；兩者皆失敗時顯示 5 秒輪詢",
    automatedEvidence: ["e2e/resilience-failure-injection.spec.ts"],
  },
  {
    id: "EDGE_503",
    expected: "已啟用雙路徑時轉入 Circuit B，且沿用同一冪等識別",
    automatedEvidence: [
      "src/lib/public-order-client.test.ts",
      "e2e/resilience-failure-injection.spec.ts",
    ],
  },
  {
    id: "NEXT_503",
    expected: "Circuit A 不受影響；不得在 A/B 之間無限重試",
    automatedEvidence: [
      "src/lib/public-order-client.test.ts",
      "src/app/api/public/order-session/route.test.ts",
    ],
  },
  {
    id: "PRIMARY_DATABASE_UNAVAILABLE",
    expected: "QR 保留菜單只讀，新 session 與訂單拒絕，離線 POS 保留 queue",
    automatedEvidence: [
      "src/server/resilience/availability-config-service.test.ts",
      "e2e/qr-degraded-mode.spec.ts",
    ],
  },
  {
    id: "DR_UNAVAILABLE",
    expected: "未提升前維持 Primary；不得自動 promotion",
    automatedEvidence: [
      "src/server/resilience/health-service.test.ts",
      "scripts/lib/dr-failover-operations.test.mjs",
    ],
  },
  {
    id: "REPLICATION_LAG",
    expected: "報表讀取退回 Primary，DR promotion readiness 失敗",
    automatedEvidence: [
      "src/server/database/read-router.test.ts",
      "src/server/resilience/replication-monitor.test.ts",
    ],
  },
  {
    id: "TURNSTILE_UNAVAILABLE",
    expected: "公開送單 fail closed；不移除或繞過 Turnstile",
    automatedEvidence: ["supabase/functions/_shared/turnstile.test.ts"],
  },
  {
    id: "LINE_PAY_UNAVAILABLE",
    expected: "只提供其他 AVAILABLE 供應商與現金／人工付款",
    automatedEvidence: ["src/server/resilience/payment-provider-health.test.ts"],
  },
  {
    id: "JKOPAY_UNAVAILABLE",
    expected: "只提供其他 AVAILABLE 供應商與現金／人工付款",
    automatedEvidence: ["src/server/resilience/payment-provider-health.test.ts"],
  },
  {
    id: "STORAGE_QUOTA_PRESSURE",
    expected: "阻止新的離線寫入或降低能力，不刪除既有 pending queue",
    automatedEvidence: ["src/offline/storage-capability.test.ts"],
  },
  {
    id: "SERVICE_WORKER_VERSION_SKEW",
    expected: "待同步資料存在時阻止更新接管，資料歸零後才允許",
    automatedEvidence: ["e2e/offline-pwa-foundation.spec.ts"],
  },
]);

export const drDryRunSteps = Object.freeze([
  {
    id: "DR_READINESS",
    script: "scripts/check-dr-readiness.mjs",
    args: ["--target", "DR"],
    action: "CHECK_DR_READINESS",
    target: "DR",
  },
  {
    id: "PRIMARY_FREEZE",
    script: "scripts/prepare-dr-failover.mjs",
    args: ["--target", "DR"],
    action: "PREPARE_DR_FAILOVER",
    target: "DR",
  },
  {
    id: "DR_PROMOTION",
    script: "scripts/switch-active-backend.mjs",
    args: ["--target", "DR"],
    action: "PROMOTE_DR",
    target: "DR",
  },
  {
    id: "DR_ACTIVE_VALIDATION",
    script: "scripts/validate-active-backend.mjs",
    args: ["--target", "DR"],
    action: "VALIDATE_DR_ACTIVE",
    target: "DR",
  },
  {
    id: "PRIMARY_FAILBACK_PREPARE",
    script: "scripts/prepare-primary-failback.mjs",
    args: ["--target", "PRIMARY"],
    action: "PREPARE_PRIMARY_FAILBACK",
    target: "PRIMARY",
  },
  {
    id: "PRIMARY_PROMOTION",
    script: "scripts/switch-active-backend.mjs",
    args: ["--target", "PRIMARY"],
    action: "PROMOTE_PRIMARY",
    target: "PRIMARY",
  },
  {
    id: "PRIMARY_ACTIVE_VALIDATION",
    script: "scripts/validate-active-backend.mjs",
    args: ["--target", "PRIMARY"],
    action: "VALIDATE_PRIMARY_ACTIVE",
    target: "PRIMARY",
  },
]);

export class GameDayError extends Error {
  constructor(code) {
    super(code);
    this.name = "GameDayError";
    this.code = code;
  }
}

export function selectFailureScenarios(ids = []) {
  if (ids.length === 0) return [...failureInjectionScenarios];
  const selected = ids.map((id) => {
    const scenario = failureInjectionScenarios.find((candidate) => candidate.id === id);
    if (!scenario) throw new GameDayError(`UNKNOWN_SCENARIO_${id}`);
    return scenario;
  });
  return [...new Map(selected.map((scenario) => [scenario.id, scenario])).values()];
}

function parseDryRunOutput(step, result) {
  if (result.status !== 0) throw new GameDayError(`DRY_RUN_FAILED_${step.id}`);
  let payload;
  try {
    payload = JSON.parse(result.stdout);
  } catch {
    throw new GameDayError(`DRY_RUN_OUTPUT_INVALID_${step.id}`);
  }
  if (
    payload.mode !== "dry-run"
    || payload.action !== step.action
    || payload.target !== step.target
  ) {
    throw new GameDayError(`DRY_RUN_CONTRACT_MISMATCH_${step.id}`);
  }
  return {
    id: step.id,
    action: payload.action,
    target: payload.target,
    applyWouldWrite: payload.writes === true,
    status: "PASS",
  };
}

export function runDrDryRunDrill({
  root = process.cwd(),
  spawn = spawnSync,
} = {}) {
  return drDryRunSteps.map((step) => {
    const result = spawn(
      process.execPath,
      [resolve(root, step.script), ...step.args],
      {
        cwd: root,
        encoding: "utf8",
        windowsHide: true,
        timeout: 30_000,
      },
    );
    return parseDryRunOutput(step, result);
  });
}

export function buildGameDayPlan({ scenarioIds = [] } = {}) {
  return {
    mode: "dry-run",
    destructiveWrites: false,
    productionAllowed: false,
    scenarios: selectFailureScenarios(scenarioIds),
    drDrill: drDryRunSteps.map(({ id, action, target }) => ({ id, action, target })),
    operatorRules: [
      "只在 Local 或隔離的 Ephemeral Validation 執行故障注入",
      "Production 只允許唯讀健康檢查與已核准 canary",
      "任何 DR apply 操作必須使用既有雙人核准與 fencing 流程",
      "輸出不得包含憑證、連線字串或顧客資料",
    ],
  };
}
