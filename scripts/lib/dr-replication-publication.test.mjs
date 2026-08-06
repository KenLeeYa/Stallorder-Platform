import { describe, expect, it } from "vitest";
import {
  assertDrPhysicalPublicationContract,
  assertPublicationContract,
  assertSubscriptionContract,
  assertSubscriptionRelations,
  assertSubscriptionScope,
  buildAlterPublicationAddTablesStatement,
  buildAlterSubscriptionRefreshStatement,
  buildReplicationUpgradePlan,
  classifyReplicationObjectState,
  quoteIdentifier,
  waitForSubscriptionScope,
} from "./dr-replication-publication.mjs";

describe("DR replication publication upgrade helpers", () => {
  it("classifies create and upgrade states but fails closed on a partial pair", () => {
    expect(classifyReplicationObjectState({
      publicationExists: false,
      subscriptionExists: false,
    })).toBe("CREATE");
    expect(() => classifyReplicationObjectState({
      publicationExists: false,
      subscriptionExists: false,
      requireExisting: true,
    })).toThrow("REPLICATION_OBJECTS_REQUIRED_FOR_UPGRADE");
    expect(classifyReplicationObjectState({
      publicationExists: true,
      subscriptionExists: true,
    })).toBe("UPGRADE");
    expect(() => classifyReplicationObjectState({
      publicationExists: true,
      subscriptionExists: false,
    })).toThrow("REPLICATION_OBJECTS_PARTIAL_STATE");
    expect(() => classifyReplicationObjectState({
      publicationExists: false,
      subscriptionExists: true,
    })).toThrow("REPLICATION_OBJECTS_PARTIAL_STATE");
  });

  it("quotes PostgreSQL identifiers in incremental statements", () => {
    expect(quoteIdentifier('primary"to"dr')).toBe('"primary""to""dr"');
    expect(buildAlterPublicationAddTablesStatement('primary"to"dr', [
      '"public"."orders"',
    ])).toBe(
      'alter publication "primary""to""dr" add table "public"."orders"',
    );
    expect(buildAlterSubscriptionRefreshStatement('primary"to"dr')).toBe(
      'alter subscription "primary""to""dr" refresh publication with (copy_data = true)',
    );
  });

  it("adds only allowlisted tables missing from the publication and refreshes DR", () => {
    const plan = buildReplicationUpgradePlan({
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      allowlistedTables: ["orders", "dining_floors"],
      publicationRows: [publicRelation("orders")],
      subscriptionRelationRows: [publicRelation("orders", "r")],
    });

    expect(plan).toMatchObject({
      mode: "ADD_TABLES_AND_REFRESH",
      missingPublicationTables: ["dining_floors"],
      missingSubscriptionTables: ["dining_floors"],
      tablesToVerify: ["dining_floors"],
      primaryStatements: [
        'alter publication "stallorder_primary_to_dr" add table "public"."dining_floors"',
      ],
      drStatements: [
        'alter subscription "stallorder_primary_to_dr" refresh publication with (copy_data = true)',
      ],
    });
  });

  it("refreshes a stale subscription without re-adding an existing publication table", () => {
    const plan = buildReplicationUpgradePlan({
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      allowlistedTables: ["orders", "dining_floors"],
      publicationRows: [publicRelation("orders"), publicRelation("dining_floors")],
      subscriptionRelationRows: [publicRelation("orders", "r")],
    });

    expect(plan.mode).toBe("REFRESH_ONLY");
    expect(plan.primaryStatements).toEqual([]);
    expect(plan.drStatements).toHaveLength(1);
    expect(plan.tablesToVerify).toEqual(["dining_floors"]);
  });

  it("recovers when the subscription relation exists before the publication add", () => {
    const plan = buildReplicationUpgradePlan({
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      allowlistedTables: ["orders", "dining_floors"],
      publicationRows: [publicRelation("orders")],
      subscriptionRelationRows: [
        publicRelation("orders", "r"),
        publicRelation("dining_floors", "r"),
      ],
    });

    expect(plan).toMatchObject({
      mode: "ADD_TABLES_AND_REFRESH",
      missingPublicationTables: ["dining_floors"],
      missingSubscriptionTables: [],
    });
  });

  it("fails closed when the publication contains a table outside the allowlist", () => {
    expect(() => buildReplicationUpgradePlan({
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      allowlistedTables: ["orders"],
      publicationRows: [publicRelation("orders"), publicRelation("unexpected_table")],
      subscriptionRelationRows: [publicRelation("orders", "r")],
    })).toThrow("PUBLICATION_HAS_UNEXPECTED_TABLES");
    expect(() => buildReplicationUpgradePlan({
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      allowlistedTables: ["orders"],
      publicationRows: [publicRelation("orders")],
      subscriptionRelationRows: [
        publicRelation("orders", "r"),
        publicRelation("unexpected_table", "r"),
      ],
    })).toThrow("SUBSCRIPTION_HAS_UNEXPECTED_TABLES");
  });

  it("returns a no-op when publication and subscription already match", () => {
    const plan = buildReplicationUpgradePlan({
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      allowlistedTables: ["orders", "dining_floors"],
      publicationRows: [publicRelation("orders"), publicRelation("dining_floors")],
      subscriptionRelationRows: [
        publicRelation("orders", "r"),
        publicRelation("dining_floors", "s"),
      ],
    });

    expect(plan).toEqual({
      mode: "NO_OP",
      missingPublicationTables: [],
      missingSubscriptionTables: [],
      tablesToVerify: [],
      primaryStatements: [],
      drStatements: [],
    });
  });

  it("requires refreshed relations to exist in an acceptable copy or ready state", () => {
    expect(assertSubscriptionRelations({
      requiredTables: ["dining_floors"],
      relationRows: [publicRelation("dining_floors", "d")],
    })).toEqual([{ table: "dining_floors", state: "d" }]);
    expect(() => assertSubscriptionRelations({
      requiredTables: ["dining_floors"],
      relationRows: [],
    })).toThrow("SUBSCRIPTION_RELATIONS_MISSING");
    expect(() => assertSubscriptionRelations({
      requiredTables: ["dining_floors"],
      relationRows: [publicRelation("dining_floors", "x")],
    })).toThrow("SUBSCRIPTION_RELATION_STATE_UNACCEPTABLE");
  });

  it("requires the exact publication flags, columns, and empty row filters", () => {
    const definition = exactPublicationDefinition();
    const columnsByTable = new Map([
      ["orders", ["id", "status"]],
      ["profiles", ["id", "auth_user_id", "display_name"]],
    ]);
    const publicationRows = [
      publicationRelation("orders", ["id", "status"]),
      publicationRelation("profiles", ["id", "display_name"]),
    ];

    expect(assertPublicationContract({
      definition,
      allowlistedTables: ["orders", "profiles"],
      publicationRows,
      columnsByTable,
      columnExclusions: { profiles: ["auth_user_id"] },
      requireComplete: true,
    })).toEqual({
      presentTables: ["orders", "profiles"],
      missingTables: [],
    });

    for (const field of Object.keys(definition)) {
      expect(() => assertPublicationContract({
        definition: { ...definition, [field]: !definition[field] },
        allowlistedTables: ["orders", "profiles"],
        publicationRows,
        columnsByTable,
        columnExclusions: { profiles: ["auth_user_id"] },
      })).toThrow("PUBLICATION_DEFINITION_MISMATCH");
    }
    expect(() => assertPublicationContract({
      definition,
      allowlistedTables: ["orders", "profiles"],
      publicationRows: [
        publicationRelation("orders", ["id", "status"]),
        publicationRelation("profiles", ["id", "auth_user_id", "display_name"]),
      ],
      columnsByTable,
      columnExclusions: { profiles: ["auth_user_id"] },
    })).toThrow("PUBLICATION_COLUMN_LIST_MISMATCH");
    expect(() => assertPublicationContract({
      definition,
      allowlistedTables: ["orders"],
      publicationRows: [
        publicationRelation("orders", ["id", "status"], "(status = 'OPEN')"),
      ],
      columnsByTable,
    })).toThrow("PUBLICATION_ROW_FILTER_MISMATCH");
  });

  it("accepts a known publication subset before an incremental add", () => {
    expect(assertPublicationContract({
      definition: exactPublicationDefinition(),
      allowlistedTables: ["orders", "dining_floors"],
      publicationRows: [publicationRelation("orders", ["id"])],
      columnsByTable: new Map([["orders", ["id"]]]),
    })).toEqual({
      presentTables: ["orders"],
      missingTables: ["dining_floors"],
    });
  });

  it("requires the exact current-database subscription contract and endpoint identity", () => {
    const definition = exactSubscriptionDefinition();
    const input = {
      definition,
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      drDirectUrl: "postgresql://postgres:dr-secret@dr.example.test:5432/postgres",
      primaryReplicationUrl:
        "postgresql://stallorder_replication:primary-secret@primary.example.test:5432/postgres?sslmode=require&options=-crow_security%3Doff",
    };

    expect(assertSubscriptionContract(input)).toEqual({
      currentDatabaseVerified: true,
      publicationVerified: true,
      slotVerified: true,
      endpointIdentityVerified: true,
      securityOptionsVerified: true,
    });
    expect(assertSubscriptionContract({
      ...input,
      definition: {
        ...definition,
        connectionInfo: input.primaryReplicationUrl,
      },
    })).toMatchObject({ endpointIdentityVerified: true });
    for (const [field, value, code] of [
      ["databaseName", "other", "SUBSCRIPTION_CURRENT_DATABASE_MISMATCH"],
      ["enabled", false, "SUBSCRIPTION_ENABLED_MISMATCH"],
      ["publications", ["other"], "SUBSCRIPTION_PUBLICATIONS_MISMATCH"],
      ["slotName", "other", "SUBSCRIPTION_SLOT_MISMATCH"],
      ["streaming", "f", "SUBSCRIPTION_STREAMING_MISMATCH"],
      ["twoPhaseState", "e", "SUBSCRIPTION_TWO_PHASE_MISMATCH"],
    ]) {
      expect(() => assertSubscriptionContract({
        ...input,
        definition: { ...definition, [field]: value },
      })).toThrow(code);
    }

    let failure;
    try {
      assertSubscriptionContract({
        ...input,
        definition: {
          ...definition,
          connectionInfo:
            "host=wrong.example.test port=5432 dbname=postgres user=stallorder_replication password='must-not-leak'",
        },
      });
    } catch (error) {
      failure = error;
    }
    expect(failure?.message).toBe("SUBSCRIPTION_ENDPOINT_IDENTITY_MISMATCH");
    expect(JSON.stringify(failure)).not.toContain("must-not-leak");
    expect(JSON.stringify(failure)).not.toContain("wrong.example.test");
  });

  it("rejects hostaddr bypasses and missing replication security options", () => {
    const input = {
      definition: exactSubscriptionDefinition(),
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      drDirectUrl: "postgresql://postgres:dr-secret@dr.example.test:5432/postgres",
      primaryReplicationUrl:
        "postgresql://stallorder_replication:primary-secret@primary.example.test:5432/postgres?sslmode=require&options=-crow_security%3Doff",
    };
    expect(() => assertSubscriptionContract({
      ...input,
      definition: {
        ...input.definition,
        connectionInfo:
          "host=primary.example.test hostaddr=203.0.113.8 port=5432 dbname=postgres user=stallorder_replication sslmode=require options='-crow_security=off'",
      },
    })).toThrow("SUBSCRIPTION_ENDPOINT_IDENTITY_MISMATCH");
    expect(() => assertSubscriptionContract({
      ...input,
      definition: {
        ...input.definition,
        connectionInfo:
          "host=primary.example.test port=5432 dbname=postgres user=stallorder_replication sslmode=prefer options='-crow_security=off'",
      },
    })).toThrow("SUBSCRIPTION_SECURITY_OPTIONS_MISMATCH");
    expect(() => assertSubscriptionContract({
      ...input,
      definition: {
        ...input.definition,
        connectionInfo:
          "host=primary.example.test port=5432 dbname=postgres user=stallorder_replication sslmode=require",
      },
    })).toThrow("SUBSCRIPTION_SECURITY_OPTIONS_MISMATCH");
    expect(() => assertSubscriptionContract({
      ...input,
      primaryReplicationUrl:
        "postgresql://stallorder_replication:primary-secret@primary.example.test:5432/postgres?sslmode=require",
    })).toThrow("PRIMARY_REPLICATION_SECURITY_OPTIONS_INVALID");
    expect(() => assertSubscriptionContract({
      ...input,
      definition: {
        ...input.definition,
        connectionInfo:
          "postgresql://stallorder_replication:primary-secret@primary.example.test:5432/postgres?host=203.0.113.8&sslmode=require&options=-crow_security%3Doff",
      },
    })).toThrow("SUBSCRIPTION_ENDPOINT_IDENTITY_MISMATCH");
    expect(() => assertSubscriptionContract({
      ...input,
      definition: {
        ...input.definition,
        connectionInfo:
          "postgresql://stallorder_replication:primary-secret@primary.example.test:5432/postgres?sslmode=require&sslmode=disable&options=-crow_security%3Doff",
      },
    })).toThrow("SUBSCRIPTION_CONNECTION_INFO_INVALID");
    expect(() => assertSubscriptionContract({
      ...input,
      definition: {
        ...input.definition,
        connectionInfo:
          "host=primary.example.test port=5432 dbname=postgres user=stallorder_replication sslmode=require options='-crow_security=off -crow_security=on'",
      },
    })).toThrow("SUBSCRIPTION_SECURITY_OPTIONS_MISMATCH");
    expect(() => assertSubscriptionContract({
      ...input,
      primaryReplicationUrl:
        "postgresql://stallorder_replication:primary-secret@primary.example.test:5432/postgres?hostaddr=&sslmode=require&options=-crow_security%3Doff",
    })).toThrow("PRIMARY_REPLICATION_SECURITY_OPTIONS_INVALID");
  });

  it("allows a disabled exact subscription only for idempotent rollback", () => {
    const definition = { ...exactSubscriptionDefinition(), enabled: false };
    const input = {
      definition,
      publicationName: "stallorder_primary_to_dr",
      subscriptionName: "stallorder_primary_to_dr",
      drDirectUrl: "postgresql://postgres:dr-secret@dr.example.test:5432/postgres",
      primaryReplicationUrl:
        "postgresql://stallorder_replication:primary-secret@primary.example.test:5432/postgres?sslmode=require&options=-crow_security%3Doff",
    };

    expect(() => assertSubscriptionContract(input)).toThrow(
      "SUBSCRIPTION_ENABLED_MISMATCH",
    );
    expect(assertSubscriptionContract({
      ...input,
      allowDisabled: true,
    })).toMatchObject({ endpointIdentityVerified: true });
  });

  it("requires every published Primary column to exist physically on DR", () => {
    const input = {
      allowlistedTables: ["orders", "profiles"],
      primaryColumnsByTable: new Map([
        ["orders", ["id", "status"]],
        ["profiles", ["id", "auth_user_id", "display_name"]],
      ]),
      drColumnsByTable: new Map([
        ["orders", ["id", "status", "dr_future_column"]],
        ["profiles", ["id", "display_name"]],
      ]),
      primaryPhysicalTables: new Map([
        ["orders", physicalTable([
          ["id", physicalColumn("uuid", true)],
          ["status", physicalColumn("text", false)],
        ])],
        ["profiles", physicalTable([
          ["id", physicalColumn("uuid", true)],
          ["auth_user_id", physicalColumn("uuid", false)],
          ["display_name", physicalColumn("text", false)],
        ])],
      ]),
      drPhysicalTables: new Map([
        ["orders", physicalTable([
          ["id", physicalColumn("uuid", true)],
          ["status", physicalColumn("text", false)],
          ["dr_future_column", physicalColumn("text", false)],
        ])],
        ["profiles", physicalTable([
          ["id", physicalColumn("uuid", true)],
          ["display_name", physicalColumn("text", false)],
        ])],
      ]),
      columnExclusions: { profiles: ["auth_user_id"] },
    };

    expect(assertDrPhysicalPublicationContract(input)).toEqual({
      verifiedTableCount: 2,
      verifiedPublishedColumnCount: 4,
    });
    expect(() => assertDrPhysicalPublicationContract({
      ...input,
      drColumnsByTable: new Map([["orders", ["id", "status"]]]),
    })).toThrow("DR_PHYSICAL_TABLES_MISSING");
    expect(() => assertDrPhysicalPublicationContract({
      ...input,
      drColumnsByTable: new Map([
        ["orders", ["id"]],
        ["profiles", ["id", "display_name"]],
      ]),
    })).toThrow("DR_PHYSICAL_COLUMNS_MISSING");
    expect(() => assertDrPhysicalPublicationContract({
      ...input,
      drPhysicalTables: new Map([
        ["orders", physicalTable([
          ["id", physicalColumn("uuid", true)],
          ["status", physicalColumn("integer", false)],
          ["dr_future_column", physicalColumn("text", false)],
        ])],
        ["profiles", input.drPhysicalTables.get("profiles")],
      ]),
    })).toThrow("DR_PHYSICAL_COLUMN_SIGNATURE_MISMATCH");
    expect(() => assertDrPhysicalPublicationContract({
      ...input,
      drPhysicalTables: new Map([
        ["orders", physicalTable([
          ["id", physicalColumn("uuid", true)],
          ["status", physicalColumn("text", false)],
          ["dr_future_column", physicalColumn("text", true)],
        ])],
        ["profiles", input.drPhysicalTables.get("profiles")],
      ]),
    })).toThrow("DR_TARGET_COLUMNS_BLOCK_REPLICATION");
    expect(() => assertDrPhysicalPublicationContract({
      ...input,
      drPhysicalTables: new Map([
        ["orders", physicalTable([
          ["id", physicalColumn("uuid", true)],
          ["status", physicalColumn("text", false)],
          ["dr_future_column", physicalColumn("text", false)],
        ], "v")],
        ["profiles", input.drPhysicalTables.get("profiles")],
      ]),
    })).toThrow("DR_PHYSICAL_TABLE_KIND_MISMATCH");
  });

  it("waits for the full subscription scope and reports initiated copy state", async () => {
    let reads = 0;
    const result = await waitForSubscriptionScope({
      allowlistedTables: ["orders", "dining_floors"],
      readRelations: async () => {
        reads += 1;
        return reads === 1
          ? [publicRelation("orders", "r")]
          : [publicRelation("orders", "r"), publicRelation("dining_floors", "i")];
      },
      maxAttempts: 2,
      intervalMilliseconds: 0,
      sleep: async () => {},
    });

    expect(reads).toBe(2);
    expect(result).toMatchObject({
      missingTables: [],
      initializationState: "INITIATED",
    });
    expect(() => assertSubscriptionScope({
      allowlistedTables: ["orders"],
      relationRows: [publicRelation("orders", "r")],
      requireComplete: true,
    })).not.toThrow();
  });

  it("fails closed when refreshed relations never appear", async () => {
    await expect(waitForSubscriptionScope({
      allowlistedTables: ["orders", "dining_floors"],
      readRelations: async () => [publicRelation("orders", "r")],
      maxAttempts: 2,
      intervalMilliseconds: 0,
      sleep: async () => {},
    })).rejects.toThrow("SUBSCRIPTION_RELATIONS_NOT_INITIATED");
  });
});

function publicRelation(tableName, state) {
  return { schemaName: "public", tableName, ...(state ? { state } : {}) };
}

function publicationRelation(tableName, columnNames, rowFilter = null) {
  return { schemaName: "public", tableName, columnNames, rowFilter };
}

function exactPublicationDefinition() {
  return {
    allTables: false,
    publishInsert: true,
    publishUpdate: true,
    publishDelete: true,
    publishTruncate: false,
    publishViaRoot: false,
  };
}

function exactSubscriptionDefinition() {
  return {
    currentDatabase: "postgres",
    databaseName: "postgres",
    enabled: true,
    publications: ["stallorder_primary_to_dr"],
    slotName: "stallorder_primary_to_dr",
    streaming: "t",
    twoPhaseState: "d",
    connectionInfo:
      "host=primary.example.test port=5432 dbname=postgres user=stallorder_replication password='primary-secret' sslmode=require options='-crow_security=off'",
  };
}

function physicalTable(columns, kind = "r") {
  return { kind, columns: new Map(columns) };
}

function physicalColumn(dataType, notNull, overrides = {}) {
  return {
    dataType,
    notNull,
    generated: "",
    identity: "",
    hasDefault: false,
    ...overrides,
  };
}
