import { describe, expect, it } from "vitest";
import {
  offlineStoreDefinitions,
  offlineStoreNames,
  withOfflineRecordMetadata,
} from "@/offline/offline-db";

describe("offline IndexedDB contract", () => {
  it("keeps every required versioned store in the schema", () => {
    expect(offlineStoreNames).toEqual([
      "device_profile",
      "device_keys",
      "offline_permit",
      "menu_snapshots",
      "stall_settings",
      "cash_shift_snapshot",
      "offline_orders",
      "offline_order_events",
      "offline_payments",
      "offline_print_jobs",
      "sync_queue",
      "sync_receipts",
      "sync_conflicts",
      "availability_config",
      "health_history",
    ]);
    expect(Object.keys(offlineStoreDefinitions)).toEqual([...offlineStoreNames]);
  });

  it("adds protocol metadata without changing a record's original creation time", () => {
    const first = withOfflineRecordMetadata(
      { id: "device", value: "first" },
      new Date("2026-07-29T00:00:00.000Z"),
    );
    const updated = withOfflineRecordMetadata(
      { ...first, value: "updated" },
      new Date("2026-07-29T01:00:00.000Z"),
    );
    expect(updated).toMatchObject({
      schema_version: 1,
      app_protocol_version: "1",
      created_at: "2026-07-29T00:00:00.000Z",
      updated_at: "2026-07-29T01:00:00.000Z",
    });
  });

  it("uses unique idempotency and print deduplication indexes", () => {
    expect(offlineStoreDefinitions.sync_queue.indexes).toContainEqual({
      name: "idempotency_key",
      keyPath: "idempotency_key",
      options: { unique: true },
    });
    expect(offlineStoreDefinitions.offline_print_jobs.indexes).toContainEqual({
      name: "deduplication_key",
      keyPath: "deduplication_key",
      options: { unique: true },
    });
  });
});
