import {
  acquireOfflineSyncLease,
  releaseOfflineSyncLease,
  renewOfflineSyncLease,
} from "@/offline/offline-db";
import { createWebUuid } from "@/lib/web-uuid";

type BrowserLock = object;

type BrowserLockManager = {
  request<T>(
    name: string,
    options: { mode: "exclusive"; ifAvailable: true },
    callback: (lock: BrowserLock | null) => Promise<T>,
  ): Promise<T>;
};

type NavigatorWithLocks = Navigator & { locks?: BrowserLockManager };

export type OfflineSyncLockResult<T> =
  | { acquired: true; value: T }
  | { acquired: false };

const LEASE_DURATION_MS = 60_000;
const LEASE_RENEWAL_MS = 10_000;

export function offlineSyncLockName(installationId: string) {
  return `stallorder-offline-sync:${installationId}`;
}

async function withNavigatorLock<T>(
  installationId: string,
  operation: () => Promise<T>,
): Promise<OfflineSyncLockResult<T> | null> {
  const lockManager = (navigator as NavigatorWithLocks).locks;
  if (!lockManager) return null;
  return lockManager.request(
    offlineSyncLockName(installationId),
    { mode: "exclusive", ifAvailable: true },
    async (lock) => lock
      ? { acquired: true as const, value: await operation() }
      : { acquired: false as const },
  );
}

async function withIndexedDbLease<T>(
  installationId: string,
  operation: () => Promise<T>,
): Promise<OfflineSyncLockResult<T>> {
  const ownerId = createWebUuid();
  const acquired = await acquireOfflineSyncLease(
    installationId,
    ownerId,
    Date.now(),
    LEASE_DURATION_MS,
  );
  if (!acquired) return { acquired: false };

  const channel = typeof BroadcastChannel === "undefined"
    ? null
    : new BroadcastChannel(offlineSyncLockName(installationId));
  channel?.postMessage({ type: "SYNC_LEADER_ACQUIRED", ownerId });
  const renewal = window.setInterval(() => {
    void renewOfflineSyncLease(
      installationId,
      ownerId,
      Date.now(),
      LEASE_DURATION_MS,
    );
    channel?.postMessage({ type: "SYNC_LEADER_HEARTBEAT", ownerId });
  }, LEASE_RENEWAL_MS);

  try {
    return { acquired: true, value: await operation() };
  } finally {
    window.clearInterval(renewal);
    await releaseOfflineSyncLease(installationId, ownerId);
    channel?.postMessage({ type: "SYNC_LEADER_RELEASED", ownerId });
    channel?.close();
  }
}

export async function withOfflineSyncLock<T>(
  installationId: string,
  operation: () => Promise<T>,
): Promise<OfflineSyncLockResult<T>> {
  if (typeof window === "undefined") {
    throw new Error("OFFLINE_SYNC_LOCK_BROWSER_ONLY");
  }
  const browserLockResult = await withNavigatorLock(installationId, operation);
  return browserLockResult ?? withIndexedDbLease(installationId, operation);
}
