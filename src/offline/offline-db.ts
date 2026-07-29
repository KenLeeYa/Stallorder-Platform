import {
  OFFLINE_APP_PROTOCOL_VERSION,
  OFFLINE_DATABASE_NAME,
  OFFLINE_DATABASE_VERSION,
  OFFLINE_SCHEMA_VERSION,
  type OfflineStorageClass,
} from "@/offline/offline-contract";

export const offlineStoreNames = [
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
] as const;

export type OfflineStoreName = (typeof offlineStoreNames)[number];

export type OfflineRecordMetadata = {
  schema_version: number;
  app_protocol_version: string;
  created_at: string;
  updated_at: string;
};

type OfflineRecord = OfflineRecordMetadata & Record<string, unknown>;

export type OfflineBootstrapBundle = {
  deviceProfile: Record<string, unknown> & { id: string };
  permit: Record<string, unknown> & { permit_id: string };
  menuSnapshot: Record<string, unknown> & { version: number };
  stallSettings: Record<string, unknown> & { stall_id: string };
  availability: Record<string, unknown> & {
    id: string;
    storage_class: OfflineStorageClass;
  };
};

type StoreDefinition = {
  keyPath: string;
  indexes?: ReadonlyArray<{
    name: string;
    keyPath: string | string[];
    options?: IDBIndexParameters;
  }>;
};

export const offlineStoreDefinitions: Record<OfflineStoreName, StoreDefinition> = {
  device_profile: { keyPath: "id" },
  device_keys: { keyPath: "id" },
  offline_permit: {
    keyPath: "permit_id",
    indexes: [{ name: "expires_at", keyPath: "expires_at" }],
  },
  menu_snapshots: {
    keyPath: "version",
    indexes: [{ name: "content_hash", keyPath: "content_hash" }],
  },
  stall_settings: { keyPath: "stall_id" },
  cash_shift_snapshot: { keyPath: "stall_id" },
  offline_orders: {
    keyPath: "local_order_id",
    indexes: [
      { name: "stall_sync_status", keyPath: ["stall_id", "sync_status"] },
      { name: "created_at", keyPath: "created_at" },
    ],
  },
  offline_order_events: {
    keyPath: "event_id",
    indexes: [{ name: "local_order_id", keyPath: "local_order_id" }],
  },
  offline_payments: {
    keyPath: "local_payment_id",
    indexes: [{ name: "local_order_id", keyPath: "local_order_id" }],
  },
  offline_print_jobs: {
    keyPath: "print_job_id",
    indexes: [{ name: "deduplication_key", keyPath: "deduplication_key", options: { unique: true } }],
  },
  sync_queue: {
    keyPath: "queue_id",
    indexes: [
      { name: "status_next_attempt", keyPath: ["status", "next_attempt_at"] },
      { name: "idempotency_key", keyPath: "idempotency_key", options: { unique: true } },
    ],
  },
  sync_receipts: { keyPath: "idempotency_key" },
  sync_conflicts: {
    keyPath: "conflict_id",
    indexes: [{ name: "resolution_status", keyPath: "resolution_status" }],
  },
  availability_config: { keyPath: "id" },
  health_history: {
    keyPath: "id",
    indexes: [{ name: "observed_at", keyPath: "observed_at" }],
  },
};

function requestResult<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.addEventListener("success", () => resolve(request.result), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("OFFLINE_DB_REQUEST_FAILED")), { once: true });
  });
}

function transactionComplete(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.addEventListener("complete", () => resolve(), { once: true });
    transaction.addEventListener("abort", () => reject(transaction.error ?? new Error("OFFLINE_DB_TRANSACTION_ABORTED")), { once: true });
    transaction.addEventListener("error", () => reject(transaction.error ?? new Error("OFFLINE_DB_TRANSACTION_FAILED")), { once: true });
  });
}

export function withOfflineRecordMetadata<T extends Record<string, unknown>>(
  record: T,
  now = new Date(),
): T & OfflineRecordMetadata {
  const timestamp = now.toISOString();
  const existingCreatedAt = typeof record.created_at === "string" ? record.created_at : timestamp;
  return {
    ...record,
    schema_version: OFFLINE_SCHEMA_VERSION,
    app_protocol_version: OFFLINE_APP_PROTOCOL_VERSION,
    created_at: existingCreatedAt,
    updated_at: timestamp,
  };
}

function createMissingStores(database: IDBDatabase, transaction: IDBTransaction) {
  for (const storeName of offlineStoreNames) {
    const definition = offlineStoreDefinitions[storeName];
    const store = database.objectStoreNames.contains(storeName)
      ? transaction.objectStore(storeName)
      : database.createObjectStore(storeName, { keyPath: definition.keyPath });
    for (const index of definition.indexes ?? []) {
      if (!store.indexNames.contains(index.name)) {
        store.createIndex(index.name, index.keyPath, index.options);
      }
    }
  }
}

export function openOfflineDatabase() {
  if (typeof indexedDB === "undefined") {
    return Promise.reject(new Error("OFFLINE_INDEXED_DB_UNAVAILABLE"));
  }

  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(OFFLINE_DATABASE_NAME, OFFLINE_DATABASE_VERSION);
    request.addEventListener("upgradeneeded", () => {
      const transaction = request.transaction;
      if (!transaction) return;
      createMissingStores(request.result, transaction);
    });
    request.addEventListener("success", () => {
      const database = request.result;
      database.addEventListener("versionchange", () => database.close());
      resolve(database);
    }, { once: true });
    request.addEventListener("blocked", () => reject(new Error("OFFLINE_DB_UPGRADE_BLOCKED")), { once: true });
    request.addEventListener("error", () => reject(request.error ?? new Error("OFFLINE_DB_OPEN_FAILED")), { once: true });
  });
}

export async function putOfflineRecord(
  storeName: OfflineStoreName,
  record: Record<string, unknown>,
) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(storeName, "readwrite", { durability: "strict" });
    const stored = withOfflineRecordMetadata(record);
    transaction.objectStore(storeName).put(stored);
    await transactionComplete(transaction);
    return stored;
  } finally {
    database.close();
  }
}

export async function getOfflineRecord<T extends OfflineRecord>(
  storeName: OfflineStoreName,
  key: IDBValidKey,
) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const result = await requestResult(transaction.objectStore(storeName).get(key));
    await transactionComplete(transaction);
    return (result as T | undefined) ?? null;
  } finally {
    database.close();
  }
}

export async function getAllOfflineRecords<T extends OfflineRecord>(storeName: OfflineStoreName) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(storeName, "readonly");
    const result = await requestResult(transaction.objectStore(storeName).getAll());
    await transactionComplete(transaction);
    return result as T[];
  } finally {
    database.close();
  }
}

export async function saveOfflineBootstrap(bundle: OfflineBootstrapBundle) {
  const database = await openOfflineDatabase();
  const stores: OfflineStoreName[] = [
    "device_profile",
    "offline_permit",
    "menu_snapshots",
    "stall_settings",
    "availability_config",
  ];
  try {
    const transaction = database.transaction(stores, "readwrite", { durability: "strict" });
    transaction.objectStore("device_profile").put(withOfflineRecordMetadata(bundle.deviceProfile));
    transaction.objectStore("offline_permit").put(withOfflineRecordMetadata(bundle.permit));
    transaction.objectStore("menu_snapshots").put(withOfflineRecordMetadata(bundle.menuSnapshot));
    transaction.objectStore("stall_settings").put(withOfflineRecordMetadata(bundle.stallSettings));
    transaction.objectStore("availability_config").put(withOfflineRecordMetadata(bundle.availability));
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}

export async function countUnsynchronizedRecords() {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction(["sync_queue", "offline_orders"], "readonly");
    const [queue, orders] = await Promise.all([
      requestResult(transaction.objectStore("sync_queue").getAll()),
      requestResult(transaction.objectStore("offline_orders").getAll()),
    ]);
    await transactionComplete(transaction);
    const pendingQueue = (queue as Array<{ status?: string }>).filter(
      (record) => !["SYNCED", "CANCELLED"].includes(record.status ?? "PENDING"),
    ).length;
    const pendingOrders = (orders as Array<{ sync_status?: string }>).filter(
      (record) => !["SYNCED", "CANCELLED"].includes(record.sync_status ?? "PENDING"),
    ).length;
    return pendingQueue + pendingOrders;
  } finally {
    database.close();
  }
}

type OfflineSyncLease = OfflineRecordMetadata & {
  id: string;
  owner_id: string;
  expires_at: string;
};

function syncLeaseId(installationId: string) {
  return `__sync_lease__:${installationId}`;
}

export async function acquireOfflineSyncLease(
  installationId: string,
  ownerId: string,
  nowMs: number,
  leaseDurationMs: number,
) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction("device_profile", "readwrite", { durability: "strict" });
    const store = transaction.objectStore("device_profile");
    const id = syncLeaseId(installationId);
    const current = await requestResult(store.get(id)) as OfflineSyncLease | undefined;
    if (
      current
      && current.owner_id !== ownerId
      && Date.parse(current.expires_at) > nowMs
    ) {
      transaction.abort();
      return false;
    }
    store.put(withOfflineRecordMetadata({
      id,
      owner_id: ownerId,
      expires_at: new Date(nowMs + leaseDurationMs).toISOString(),
    }, new Date(nowMs)));
    await transactionComplete(transaction);
    return true;
  } finally {
    database.close();
  }
}

export async function renewOfflineSyncLease(
  installationId: string,
  ownerId: string,
  nowMs: number,
  leaseDurationMs: number,
) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction("device_profile", "readwrite", { durability: "strict" });
    const store = transaction.objectStore("device_profile");
    const id = syncLeaseId(installationId);
    const current = await requestResult(store.get(id)) as OfflineSyncLease | undefined;
    if (!current || current.owner_id !== ownerId) {
      transaction.abort();
      return false;
    }
    store.put(withOfflineRecordMetadata({
      ...current,
      expires_at: new Date(nowMs + leaseDurationMs).toISOString(),
    }, new Date(nowMs)));
    await transactionComplete(transaction);
    return true;
  } finally {
    database.close();
  }
}

export async function releaseOfflineSyncLease(installationId: string, ownerId: string) {
  const database = await openOfflineDatabase();
  try {
    const transaction = database.transaction("device_profile", "readwrite", { durability: "strict" });
    const store = transaction.objectStore("device_profile");
    const id = syncLeaseId(installationId);
    const current = await requestResult(store.get(id)) as OfflineSyncLease | undefined;
    if (current?.owner_id === ownerId) store.delete(id);
    await transactionComplete(transaction);
  } finally {
    database.close();
  }
}
