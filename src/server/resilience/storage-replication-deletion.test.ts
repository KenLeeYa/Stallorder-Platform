import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  manifestFindUnique: vi.fn(),
  manifestUpsert: vi.fn(),
  manifestUpdate: vi.fn(),
  jobCreate: vi.fn(),
  jobFindMany: vi.fn(),
  jobUpdate: vi.fn(),
  jobUpdateMany: vi.fn(),
  primaryRemove: vi.fn(),
  drRemove: vi.fn(),
}));

const transaction = {
  storageObjectManifest: {
    findUnique: mocks.manifestFindUnique,
    upsert: mocks.manifestUpsert,
    update: mocks.manifestUpdate,
  },
  storageReplicationJob: {
    create: mocks.jobCreate,
    updateMany: mocks.jobUpdateMany,
  },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/audit", () => ({ logEvent: vi.fn() }));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (input: unknown) => typeof input === "function"
      ? (input as (value: typeof transaction) => unknown)(transaction)
      : Promise.all(input as Promise<unknown>[]),
    storageObjectManifest: { update: mocks.manifestUpdate },
    storageReplicationJob: {
      create: mocks.jobCreate,
      findMany: mocks.jobFindMany,
      update: mocks.jobUpdate,
      updateMany: mocks.jobUpdateMany,
    },
  },
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (url: string) => ({
    storage: {
      from: () => ({
        remove: url.includes("primary") ? mocks.primaryRemove : mocks.drRemove,
      }),
    },
  }),
}));

import {
  enqueueStorageDeletion,
  processStorageReplicationJobs,
} from "./storage-replication-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const objectPath = `${organizationId}/stall-banners/22222222-2222-4222-8222-222222222222/33333333-3333-4333-8333-333333333333.webp`;

describe("storage deletion lifecycle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("PRIMARY_SUPABASE_URL", "https://primary.example.test");
    vi.stubEnv("PRIMARY_SUPABASE_SECRET_KEY", "primary-secret");
    vi.stubEnv("DR_SUPABASE_URL", "https://dr.example.test");
    vi.stubEnv("DR_SUPABASE_SECRET_KEY", "dr-secret");
    mocks.jobUpdateMany.mockResolvedValue({ count: 0 });
    mocks.jobCreate.mockResolvedValue({ id: "job-1" });
    mocks.manifestUpdate.mockResolvedValue({});
    mocks.jobUpdate.mockResolvedValue({});
    mocks.primaryRemove.mockResolvedValue({ error: null });
    mocks.drRemove.mockResolvedValue({ error: null });
  });

  it("persists an idempotent deletion tombstone and queues one worker job", async () => {
    mocks.manifestFindUnique.mockResolvedValue(null);
    mocks.manifestUpsert.mockResolvedValue({ id: "manifest-1" });

    await expect(enqueueStorageDeletion({
      organizationId,
      bucket: "product-images",
      objectPath,
      contentType: "image/webp",
    })).resolves.toBe("manifest-1");

    expect(mocks.manifestUpsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ deletedAt: expect.any(Date), replicationStatus: "PENDING" }),
    }));
    expect(mocks.jobCreate).toHaveBeenCalledOnce();
  });

  it("removes a tombstoned object from Primary and DR before marking it deleted", async () => {
    mocks.jobFindMany.mockResolvedValue([{
      id: "job-1",
      manifestId: "manifest-1",
      status: "PENDING",
      attemptCount: 0,
      claimedAt: null,
      manifest: {
        id: "manifest-1",
        bucket: "product-images",
        objectPath,
        contentType: "image/webp",
        primaryChecksum: null,
        deletedAt: new Date(),
      },
    }]);
    mocks.jobUpdateMany.mockResolvedValue({ count: 1 });

    await expect(processStorageReplicationJobs(10)).resolves.toMatchObject({
      processed: 1,
      mirrored: 0,
      deleted: 1,
      failed: 0,
    });

    expect(mocks.primaryRemove).toHaveBeenCalledWith([objectPath]);
    expect(mocks.drRemove).toHaveBeenCalledWith([objectPath]);
    expect(mocks.manifestUpdate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ replicationStatus: "DELETED" }),
    }));
  });

  it("reclaims an expired processing lease but commits only while it still owns that lease", async () => {
    const staleClaimedAt = new Date(Date.now() - 10 * 60_000);
    mocks.jobFindMany.mockResolvedValue([{
      id: "job-1",
      manifestId: "manifest-1",
      status: "PROCESSING",
      attemptCount: 1,
      claimedAt: staleClaimedAt,
      manifest: {
        id: "manifest-1",
        bucket: "product-images",
        objectPath,
        contentType: "image/webp",
        primaryChecksum: null,
        deletedAt: new Date(),
      },
    }]);
    mocks.jobUpdateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });

    await expect(processStorageReplicationJobs(10)).resolves.toMatchObject({
      processed: 0,
      deleted: 0,
      failed: 0,
    });

    expect(mocks.jobUpdateMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: expect.objectContaining({ status: "PROCESSING", claimedAt: staleClaimedAt }),
      data: expect.objectContaining({ status: "PROCESSING", claimedAt: expect.any(Date) }),
    }));
    expect(mocks.manifestUpdate).not.toHaveBeenCalled();
  });
});
