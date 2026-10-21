import { describe, expect, it } from "vitest";
import { assertRetiredAlias } from "./staging-retired-entry.mjs";
import { STAGING_TARGET } from "./dr-staging-conversion-plan.mjs";

describe("retired DR public aliases", () => {
  it("requires the exact backed-up alias, deployment and DR project before detaching", () => {
    const expected = { host: "dr.qidaigo.com", aliasId: "fixture-alias", deploymentId: "dpl_fixture" };
    const alias = { alias: expected.host, uid: expected.aliasId, deploymentId: expected.deploymentId, projectId: STAGING_TARGET.project };
    expect(() => assertRetiredAlias(alias, expected)).not.toThrow();
    for (const change of [{ alias: "app.qidaigo.com" }, { projectId: STAGING_TARGET.primaryProject },
      { uid: "changed" }, { deploymentId: "dpl_other" }]) {
      expect(() => assertRetiredAlias({ ...alias, ...change }, expected)).toThrow("STAGING_RETIRED_ALIAS_CHANGED");
    }
  });
});
