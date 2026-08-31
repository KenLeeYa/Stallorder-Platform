import { describe, expect, it } from "vitest";
import { buildDrOperatorReadiness } from "./dr-operator-readiness";

const now = new Date("2026-09-01T00:00:00.000Z");

describe("DR operator readiness", () => {
  it("accepts only an epoch-aligned, fenced DR read-only standby", () => {
    const result = buildDrOperatorReadiness({
      BACKEND_ACTIVE_TARGET: "DR",
      AUTH_PROJECT_CODE: "DR",
      PROMOTION_EPOCH: "4",
      DR_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: "https://abcdefghijklmnopqrst.supabase.co/functions/v1",
    }, {
      backendCode: "DR",
      backendRole: "READ_ONLY_STANDBY",
      promotionEpoch: 4,
      writesEnabled: false,
      enforcementEnabled: true,
    }, now);

    expect(result).toEqual({
      status: "READY",
      checkedAt: now.toISOString(),
      runtime: {
        backendTarget: "DR",
        authProjectCode: "DR",
        promotionEpoch: 4,
        supabaseProjectRef: "abcdefghijklmnopqrst",
      },
      database: {
        backendCode: "DR",
        backendRole: "READ_ONLY_STANDBY",
        promotionEpoch: 4,
        writesEnabled: false,
        enforcementEnabled: true,
      },
      checks: {
        drRuntimeBinding: true,
        supabaseProjectBinding: true,
        epochAligned: true,
        readOnlyStandby: true,
        writerFence: true,
      },
    });
  });

  it.each([
    ["Primary binding", { BACKEND_ACTIVE_TARGET: "PRIMARY", AUTH_PROJECT_CODE: "DR", PROMOTION_EPOCH: "4" }],
    ["wrong epoch", { BACKEND_ACTIVE_TARGET: "DR", AUTH_PROJECT_CODE: "DR", PROMOTION_EPOCH: "5" }],
  ])("blocks %s", (_label, environment) => {
    const result = buildDrOperatorReadiness({
      DR_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: "https://abcdefghijklmnopqrst.supabase.co/functions/v1",
      ...environment,
    }, {
      backendCode: "DR",
      backendRole: "READ_ONLY_STANDBY",
      promotionEpoch: 4,
      writesEnabled: false,
      enforcementEnabled: true,
    }, now);

    expect(result.status).toBe("BLOCKED");
  });

  it("blocks a writable or unfenced DR database", () => {
    const result = buildDrOperatorReadiness({
      BACKEND_ACTIVE_TARGET: "DR",
      AUTH_PROJECT_CODE: "DR",
      PROMOTION_EPOCH: "4",
      DR_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      NEXT_PUBLIC_SUPABASE_URL: "https://abcdefghijklmnopqrst.supabase.co",
      NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: "https://abcdefghijklmnopqrst.supabase.co/functions/v1",
    }, {
      backendCode: "DR",
      backendRole: "ACTIVE_WRITER",
      promotionEpoch: 4,
      writesEnabled: true,
      enforcementEnabled: false,
    }, now);

    expect(result).toMatchObject({
      status: "BLOCKED",
      checks: {
        readOnlyStandby: false,
        writerFence: false,
      },
    });
  });

  it("blocks a Primary Supabase binding even when the database is DR", () => {
    const result = buildDrOperatorReadiness({
      BACKEND_ACTIVE_TARGET: "DR",
      AUTH_PROJECT_CODE: "DR",
      PROMOTION_EPOCH: "4",
      DR_SUPABASE_PROJECT_REF: "abcdefghijklmnopqrst",
      NEXT_PUBLIC_SUPABASE_URL: "https://primaryprimaryprimary.supabase.co",
      NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL: "https://primaryprimaryprimary.supabase.co/functions/v1",
    }, {
      backendCode: "DR",
      backendRole: "READ_ONLY_STANDBY",
      promotionEpoch: 4,
      writesEnabled: false,
      enforcementEnabled: true,
    }, now);

    expect(result).toMatchObject({
      status: "BLOCKED",
      checks: { supabaseProjectBinding: false },
    });
  });
});
