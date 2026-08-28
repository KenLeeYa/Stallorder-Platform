import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeRaw: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  updateMany: vi.fn(),
  findUnique: vi.fn(),
  productCount: vi.fn(),
  enqueueStorageDeletion: vi.fn(),
}));

const transaction = {
  $executeRaw: mocks.executeRaw,
  catalogImageUpload: {
    count: mocks.count,
    create: mocks.create,
    updateMany: mocks.updateMany,
    findUnique: mocks.findUnique,
  },
  product: { count: mocks.productCount },
};

vi.mock("server-only", () => ({}));
vi.mock("@/lib/prisma", () => ({
  prisma: {
    $transaction: (task: (value: typeof transaction) => unknown) => task(transaction),
    catalogImageUpload: {
      updateMany: mocks.updateMany,
      findMany: vi.fn(),
    },
  },
}));
vi.mock("@/server/resilience/storage-replication-service", () => ({
  enqueueStorageDeletion: mocks.enqueueStorageDeletion,
}));

import {
  attachCatalogImageUpload,
  CatalogImageLeaseError,
  CatalogImageQuotaError,
  enqueueUnreferencedCatalogImageDeletion,
  reserveCatalogImageUpload,
} from "./catalog-image-upload-service";

const organizationId = "11111111-1111-4111-8111-111111111111";
const objectPath = `${organizationId}/22222222-2222-4222-8222-222222222222.webp`;

describe("catalog image staged uploads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.executeRaw.mockResolvedValue(0);
  });

  it("enforces the organization quota while holding an advisory transaction lock", async () => {
    mocks.count.mockResolvedValue(20);

    await expect(reserveCatalogImageUpload(organizationId, objectPath))
      .rejects.toBeInstanceOf(CatalogImageQuotaError);

    expect(mocks.executeRaw).toHaveBeenCalledOnce();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("atomically attaches a valid managed image lease", async () => {
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(attachCatalogImageUpload(
      transaction as never,
      organizationId,
      `https://app.example.test/api/assets/product-images/${objectPath}`,
    )).resolves.toBeUndefined();

    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId, objectPath, attachedAt: null }),
      data: { attachedAt: expect.any(Date) },
    }));
  });

  it("rejects an expired or cross-organization managed lease", async () => {
    mocks.updateMany.mockResolvedValue({ count: 0 });
    mocks.findUnique.mockResolvedValue(null);

    await expect(attachCatalogImageUpload(
      transaction as never,
      organizationId,
      `https://app.example.test/api/assets/product-images/${objectPath}`,
    )).rejects.toBeInstanceOf(CatalogImageLeaseError);
  });

  it("queues Primary and DR deletion only after the last product reference is gone", async () => {
    mocks.productCount.mockResolvedValue(0);
    mocks.enqueueStorageDeletion.mockResolvedValue("manifest-1");
    mocks.updateMany.mockResolvedValue({ count: 1 });

    await expect(enqueueUnreferencedCatalogImageDeletion(
      transaction as never,
      organizationId,
      `https://app.example.test/api/assets/product-images/${objectPath}`,
    )).resolves.toBe(true);

    expect(mocks.enqueueStorageDeletion).toHaveBeenCalledWith({
      organizationId,
      bucket: "product-images",
      objectPath,
      contentType: "image/webp",
    }, transaction);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ organizationId, objectPath }),
      data: { cleanupRequestedAt: expect.any(Date) },
    }));
  });

  it("keeps shared clone images while another product still references them", async () => {
    mocks.productCount.mockResolvedValue(1);

    await expect(enqueueUnreferencedCatalogImageDeletion(
      transaction as never,
      organizationId,
      `https://app.example.test/api/assets/product-images/${objectPath}`,
    )).resolves.toBe(false);

    expect(mocks.enqueueStorageDeletion).not.toHaveBeenCalled();
  });
});
