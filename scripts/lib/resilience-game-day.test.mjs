import { describe, expect, it } from "vitest";
import {
  GameDayError,
  buildGameDayPlan,
  drDryRunSteps,
  failureInjectionScenarios,
  runDrDryRunDrill,
  selectFailureScenarios,
} from "./resilience-game-day.mjs";

describe("生產韌性 Game Day", () => {
  it("涵蓋主提示要求的全部故障注入情境", () => {
    expect(failureInjectionScenarios.map((scenario) => scenario.id)).toEqual([
      "REALTIME_UNAVAILABLE",
      "SSE_UNAVAILABLE",
      "EDGE_503",
      "NEXT_503",
      "PRIMARY_DATABASE_UNAVAILABLE",
      "DR_UNAVAILABLE",
      "REPLICATION_LAG",
      "TURNSTILE_UNAVAILABLE",
      "LINE_PAY_UNAVAILABLE",
      "JKOPAY_UNAVAILABLE",
      "STORAGE_QUOTA_PRESSURE",
      "SERVICE_WORKER_VERSION_SKEW",
    ]);
    expect(failureInjectionScenarios.every(
      (scenario) => scenario.automatedEvidence.length > 0,
    )).toBe(true);
  });

  it("拒絕未知情境且移除重複選取", () => {
    expect(selectFailureScenarios(["EDGE_503", "EDGE_503"])).toHaveLength(1);
    expect(() => selectFailureScenarios(["UNKNOWN"])).toThrow(GameDayError);
  });

  it("計畫明確禁止 Production 與破壞性寫入", () => {
    expect(buildGameDayPlan({ scenarioIds: ["EDGE_503"] })).toMatchObject({
      mode: "dry-run",
      destructiveWrites: false,
      productionAllowed: false,
      scenarios: [{ id: "EDGE_503" }],
    });
  });

  it("驗證 DR 與 failback dry-run 契約，不執行 apply", () => {
    const calls = [];
    const receipts = runDrDryRunDrill({
      root: "C:\\safe-clone",
      spawn: (_command, args) => {
        calls.push(args);
        const step = drDryRunSteps[calls.length - 1];
        return {
          status: 0,
          stdout: JSON.stringify({
            mode: "dry-run",
            action: step.action,
            target: step.target,
            writes: step.action.includes("PROMOTE") || step.action.includes("PREPARE"),
          }),
          stderr: "",
        };
      },
    });
    expect(receipts).toHaveLength(7);
    expect(receipts.every((receipt) => receipt.status === "PASS")).toBe(true);
    expect(calls.flat()).not.toContain("--apply");
  });

  it("dry-run 子程序失敗時停止演練", () => {
    expect(() => runDrDryRunDrill({
      spawn: () => ({ status: 1, stdout: "", stderr: "" }),
    })).toThrow("DRY_RUN_FAILED_DR_READINESS");
  });
});
