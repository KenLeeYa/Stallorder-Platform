import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { buildVercelCliEnvironment } from "./dr-operator-entry.mjs";

const source = readFileSync(new URL("../manage-dr-operator-entry.mjs", import.meta.url), "utf8");
const secret = "dr-fixture-credential-only";
const bypass = { [secret]: { scope: "automation-bypass" } };

async function prepare(project = { id: "prj_dr", name: "stallorder-dr", protectionBypass: bypass }) {
  const start = source.indexOf("async function prepareDeploymentProtectionCredential");
  const end = source.indexOf("async function deployDrRuntime", start);
  expect(start).toBeGreaterThan(-1);
  const provider = vi.fn(async (route, init) => {
    expect(route).toMatch(/^\/v[19]\/projects\/prj_dr(?:\/protection-bypass)?$/u);
    return init?.method === "PATCH" ? { protectionBypass: bypass } : project;
  });
  const invoke = new Function("vercel", "sourceProjectId", `${source.slice(start, end)}\nreturn prepareDeploymentProtectionCredential;`)(provider, "prj_primary");
  return invoke("prj_dr");
}

describe("DR probe credential provisioning", () => {
  it("prepares the credential before building and passes it to the protected probe", () => {
    const prepareAt = source.indexOf("await prepareDeploymentProtectionCredential(targetProjectId)");
    const buildAt = source.indexOf("await deployDrRuntime(plan, accessResources, targetProjectId, probeCredential)");
    expect(prepareAt).toBeGreaterThan(-1);
    expect(prepareAt).toBeLessThan(buildAt);
    expect(source).toContain("await vercelCurl(deploymentUrl, targetProjectId, probeCredential)");
  });

  it("returns only the newly generated credential after exact project readback", async () => {
    await expect(prepare()).resolves.toBe(secret);
  });

  it.each([
    { id: "prj_primary", name: "stallorder-dr", protectionBypass: bypass },
    { id: "prj_dr", name: "another-project", protectionBypass: bypass },
    { id: "prj_dr", name: "stallorder-dr", protectionBypass: {} },
    { id: "prj_dr", name: "stallorder-dr", protectionBypass: { [secret]: { scope: "shareable-link" } } },
  ])("rejects mismatched project or credential readback without exposing the credential", async (project) => {
    const error = await prepare(project).catch((value) => value);
    expect(error.message).toBe("DR_ENTRY_PROBE_CREDENTIAL_READBACK_FAILED");
    expect(JSON.stringify(error)).not.toContain(secret);
  });

  it("drops an unrelated ambient credential and uses only an explicit probe credential", () => {
    const input = {
      baseEnv: { VERCEL_AUTOMATION_BYPASS_SECRET: "unrelated-project-secret", KEEP: "value" },
      vercelTeamId: "team_owner",
      projectId: "prj_dr",
    };
    expect(buildVercelCliEnvironment(input).VERCEL_AUTOMATION_BYPASS_SECRET).toBeUndefined();
    expect(buildVercelCliEnvironment({ ...input, automationBypassSecret: secret }))
      .toMatchObject({ VERCEL_AUTOMATION_BYPASS_SECRET: secret, KEEP: "value", VERCEL_PROJECT_ID: "prj_dr" });
    expect(input.baseEnv.VERCEL_AUTOMATION_BYPASS_SECRET).toBe("unrelated-project-secret");
  });
});
