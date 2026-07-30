import type { OfflineStorageClass } from "@/offline/offline-contract";

export type StorageCapabilityThresholds = {
  minimumAvailableBytes: number;
  criticalUsagePercent: number;
};

export type StorageCapabilityInput = {
  indexedDbAvailable: boolean;
  storageApiAvailable: boolean;
  usageBytes: number | null;
  quotaBytes: number | null;
  persisted: boolean;
};

export type StorageCapability = {
  classification: OfflineStorageClass;
  usageBytes: number | null;
  quotaBytes: number | null;
  availableBytes: number | null;
  usagePercent: number | null;
  persisted: boolean;
};

export const defaultStorageCapabilityThresholds: StorageCapabilityThresholds = {
  minimumAvailableBytes: 50 * 1024 * 1024,
  criticalUsagePercent: 90,
};

export function classifyStorageCapability(
  input: StorageCapabilityInput,
  thresholds: StorageCapabilityThresholds = defaultStorageCapabilityThresholds,
): StorageCapability {
  if (!input.indexedDbAvailable || !input.storageApiAvailable) {
    return {
      classification: "UNAVAILABLE",
      usageBytes: input.usageBytes,
      quotaBytes: input.quotaBytes,
      availableBytes: null,
      usagePercent: null,
      persisted: false,
    };
  }

  const usageBytes = Math.max(0, input.usageBytes ?? 0);
  const quotaBytes = input.quotaBytes && input.quotaBytes > 0 ? input.quotaBytes : null;
  const availableBytes = quotaBytes === null ? null : Math.max(0, quotaBytes - usageBytes);
  const usagePercent = quotaBytes === null
    ? null
    : Math.min(100, Math.round((usageBytes / quotaBytes) * 10_000) / 100);
  const insufficient = quotaBytes === null
    || availableBytes === null
    || usagePercent === null
    || availableBytes < thresholds.minimumAvailableBytes
    || usagePercent >= thresholds.criticalUsagePercent;

  return {
    classification: insufficient
      ? "INSUFFICIENT"
      : input.persisted
        ? "PERSISTENT"
        : "BEST_EFFORT",
    usageBytes,
    quotaBytes,
    availableBytes,
    usagePercent,
    persisted: input.persisted,
  };
}

export async function assessStorageCapability(
  thresholds: StorageCapabilityThresholds = defaultStorageCapabilityThresholds,
): Promise<StorageCapability> {
  if (
    typeof window === "undefined"
    || !("indexedDB" in window)
    || !navigator.storage?.estimate
  ) {
    return classifyStorageCapability({
      indexedDbAvailable: false,
      storageApiAvailable: false,
      usageBytes: null,
      quotaBytes: null,
      persisted: false,
    }, thresholds);
  }

  try {
    const estimate = await navigator.storage.estimate();
    const alreadyPersisted = await navigator.storage.persisted?.() ?? false;
    const persisted = alreadyPersisted || await navigator.storage.persist?.() || false;
    return classifyStorageCapability({
      indexedDbAvailable: true,
      storageApiAvailable: true,
      usageBytes: estimate.usage ?? null,
      quotaBytes: estimate.quota ?? null,
      persisted,
    }, thresholds);
  } catch {
    return classifyStorageCapability({
      indexedDbAvailable: true,
      storageApiAvailable: false,
      usageBytes: null,
      quotaBytes: null,
      persisted: false,
    }, thresholds);
  }
}
