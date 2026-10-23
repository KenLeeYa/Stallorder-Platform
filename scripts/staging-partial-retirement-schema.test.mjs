import { beforeEach, describe, expect, it, vi } from "vitest";
import { remainingSchemaQuery, validateRemainingSchema, captureRemainingSchema, compareRemainingSchemaReadOnly } from "./staging-partial-retirement-schema.mjs";

const query = vi.hoisted(() => vi.fn());
vi.mock("./dr-staging-conversion-plan.mjs", () => ({ conversionQuery: query }));
function snapshot() {
  return { version: 1, searchPath: '"$user", public', serverMajor: 17, retiredSchemas: 0, unsupported: 0,
    objects: [{ kind: "schema", identity: "public", definition: { owner: "postgres", acl: null } }],
    dependencies: [], sharedDependencies: [], sequences: [], sequenceStates: [] };
}

describe("private remaining schema comparison, not a continuation gate", () => {
  beforeEach(() => { query.mockReset(); });

  it("uses one read-only fixed-DR query and returns no private catalog or qualification claim", async () => {
    query.mockResolvedValue([{ remaining_schema: snapshot() }]);
    expect(await compareRemainingSchemaReadOnly(snapshot())).toEqual({ diagnosticOnly: true,
      planQualified: false, remainingDataProven: false, remainingSchemaProven: false,
      remainingCatalogMatched: true, sequenceStateMatched: true, objectCount: 1, sequenceCount: 0 });
    expect(query).toHaveBeenCalledExactlyOnceWith(remainingSchemaQuery([]), true);
    expect(() => validateRemainingSchema({ ...snapshot(), retiredSchemas: 1 })).toThrow(/^STAGING_PARTIAL_SCHEMA_INVALID$/);
  });

  it("rejects every represented structural or sequence drift without logging definitions", async () => {
    const expected = snapshot();
    expected.sequences = [{ schema: "public", name: "owned_id" }];
    expected.sequenceStates = [{ schema: "public", name: "owned_id", value: "9007199254740993", called: false }];
    expected.dependencies = [{ type: "a", fromType: "sequence", from: "public.owned_id", toType: "table column", to: "public.jobs.id" }];
    expected.sharedDependencies = [{ type: "o", objectType: "schema", object: "public", role: "postgres" }];
    for (const change of [
      s => { s.objects[0].definition.owner = "other"; }, s => { s.objects[0].definition.acl = ["changed"]; },
      s => { s.objects.push({ kind: "routine", identity: "public.extra()", definition: { body: "private SQL" } }); },
      s => { s.dependencies = []; }, s => { s.sharedDependencies[0].role = "other"; },
      s => { s.sequenceStates[0].value = "9007199254740992"; }, s => { s.sequenceStates[0].called = true; },
      s => { s.searchPath = "other"; },
    ]) {
      const actual = structuredClone(expected); change(actual);
      query.mockResolvedValue([{ remaining_schema: actual }]);
      await expect(compareRemainingSchemaReadOnly(expected)).rejects.toThrow(/^STAGING_PARTIAL_SCHEMA_MISMATCH$/);
    }
  });

  it("rejects unsupported/malformed/missing catalogs and sequence states before network", async () => {
    for (const change of [s => { s.unsupported = 1; }, s => { s.serverMajor = 18; }, s => { s.objects = []; },
      s => { s.objects.push(s.objects[0]); }, s => { s.objects[0].kind = "unknown"; },
      s => { s.sequences = [{ schema: "pg_catalog", name: "x" }]; },
      s => { s.sequences = [{ schema: "public", name: "missing" }]; },
      s => { s.dependencies = [null]; }, s => { s.sharedDependencies = [{}]; }]) {
      const expected = snapshot(); change(expected);
      await expect(compareRemainingSchemaReadOnly(expected)).rejects.toThrow(/^STAGING_PARTIAL_SCHEMA_INVALID$/);
    }
    expect(query).not.toHaveBeenCalled();
    query.mockRejectedValue(new Error("private query credential"));
    await expect(compareRemainingSchemaReadOnly(snapshot())).rejects.toThrow(/^STAGING_PARTIAL_SCHEMA_READ_FAILED$/);
    query.mockResolvedValue([{ remaining_schema: "private SQL" }]);
    await expect(compareRemainingSchemaReadOnly(snapshot())).rejects.toThrow(/^STAGING_PARTIAL_SCHEMA_INVALID$/);
  });

  it("projects semantic DDL and exact sequence state without invoking application code or changing settings", () => {
    const sql = remainingSchemaQuery([{ schema: "public", name: 'seq"odd' }]);
    for (const text of ["pg_get_functiondef", "pg_get_constraintdef", "pg_get_indexdef", "pg_get_triggerdef",
      "pg_get_ruledef", "pg_policy", "pg_default_acl", "pg_type", "pg_range", "pg_depend", "pg_shdepend",
      "pg_attribute", "pg_sequence", "last_value::pg_catalog.text", "is_called", "unsupported", "relowner", "relacl"]) {
      expect(sql).toContain(text);
    }
    expect(sql).toContain('from "public"."seq""odd"');
    // Physical TOAST names contain new relation OIDs after restore; preserve
    // their exact owning-table dependency instead of dropping that edge.
    expect(sql).toContain("owner.reltoastrelid=d.objid and owner.oid=d.refobjid");
    expect(sql).toContain("'TOAST FOR '||t.identity");
    expect(sql).toContain("'internalTrigger'");
    expect(sql).toContain("'enabled',t.tgenabled");
    // A hostile search_path must not route these reads through application
    // functions. The search_path comparison is additional evidence, not safety.
    expect(sql).not.toMatch(/(?<![\w.])(?:pg_[a-z_]+|jsonb_build_object|jsonb_agg|to_jsonb|format_type|current_setting|encode|unnest)\(/);
    expect(sql).not.toContain("pg_catalog.pg_catalog");
    expect(sql).not.toMatch(/\b(insert|update|delete|truncate|drop|alter|create|set|call|do|nextval|setval)\s/i);
    for (const input of [[{ schema: "public", name: "bad\0name" }], [{ schema: "public", name: "s", target: "override" }]]) {
      expect(() => remainingSchemaQuery(input)).toThrow(/^STAGING_PARTIAL_SCHEMA_INVALID$/);
    }
  });

  it("derives exact sequence reads from the restored catalog and never leaks a malformed private response", () => {
    const catalog = snapshot(); catalog.sequences = [{ schema: "public", name: "owned_id" }];
    const complete = { ...catalog, sequenceStates: [{ schema: "public", name: "owned_id", value: "1", called: true }] };
    const sql = vi.fn().mockReturnValueOnce(JSON.stringify(catalog)).mockReturnValueOnce(JSON.stringify(complete));
    expect(captureRemainingSchema(sql)).toEqual(complete);
    expect(sql.mock.calls).toEqual([[remainingSchemaQuery([])], [remainingSchemaQuery(catalog.sequences)]]);
    expect(() => captureRemainingSchema(() => "private non-JSON credential")).toThrow(/^STAGING_PARTIAL_SCHEMA_CAPTURE_FAILED$/);
    expect(query).not.toHaveBeenCalled();
  });
});
