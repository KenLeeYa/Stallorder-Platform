import "server-only";

import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import {
  assertCatalogVersionTransition,
  type CatalogVersionStatus,
} from "@/server/catalog-versions/catalog-version-contract";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export class CatalogVersionOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "CatalogVersionOperationError";
  }
}

async function assertHqModuleEnabled(organizationId: string) {
  const flags = await resolveResilienceFeatureFlags(
    ["MODULE_HQ_ENABLED"],
    { organizationId, rolloutKey: organizationId },
  );
  if (!flags.MODULE_HQ_ENABLED.enabled) {
    throw new CatalogVersionOperationError("HQ_MODULE_DISABLED");
  }
}

function snapshotChecksum(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

export async function listCatalogVersions(organizationId: string, menuKey = "DEFAULT") {
  await assertHqModuleEnabled(organizationId);
  const versions = await prisma.catalogMenuVersion.findMany({
    where: { organizationId, menuKey },
    orderBy: [{ versionNumber: "desc" }, { id: "desc" }],
    take: 100,
  });
  if (versions.length === 0) return [];

  const [itemCounts, publicationCounts] = await Promise.all([
    prisma.catalogVersionItem.groupBy({
      by: ["versionId"],
      where: { organizationId, versionId: { in: versions.map((version) => version.id) } },
      _count: { _all: true },
    }),
    prisma.catalogPublication.groupBy({
      by: ["versionId"],
      where: { organizationId, versionId: { in: versions.map((version) => version.id) } },
      _count: { _all: true },
    }),
  ]);
  const itemsByVersion = new Map(itemCounts.map((row) => [row.versionId, row._count._all]));
  const publicationsByVersion = new Map(publicationCounts.map((row) => [row.versionId, row._count._all]));

  return versions.map((version) => ({
    id: version.id,
    menuKey: version.menuKey,
    name: version.name,
    versionNumber: version.versionNumber,
    status: version.status as CatalogVersionStatus,
    currency: version.currency,
    sourceVersionId: version.sourceVersionId,
    scheduledPublishAt: version.scheduledPublishAt?.toISOString() ?? null,
    publishedAt: version.publishedAt?.toISOString() ?? null,
    checksum: version.checksum,
    itemCount: itemsByVersion.get(version.id) ?? 0,
    publicationCount: publicationsByVersion.get(version.id) ?? 0,
    createdAt: version.createdAt.toISOString(),
    updatedAt: version.updatedAt.toISOString(),
  }));
}

export async function createCatalogDraft(input: {
  organizationId: string;
  profileId: string;
  name: string;
  menuKey?: string;
  sourceVersionId?: string | null;
}) {
  await assertHqModuleEnabled(input.organizationId);
  const menuKey = input.menuKey ?? "DEFAULT";

  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      select pg_advisory_xact_lock(
        hashtextextended(${`catalog-version:${input.organizationId}:${menuKey}`}::text, 0)
      )
    `);

    const sourceVersion = input.sourceVersionId
      ? await transaction.catalogMenuVersion.findFirst({
        where: {
          id: input.sourceVersionId,
          organizationId: input.organizationId,
          menuKey,
        },
        select: { id: true },
      })
      : null;
    if (input.sourceVersionId && !sourceVersion) {
      throw new CatalogVersionOperationError("CATALOG_SOURCE_VERSION_NOT_FOUND");
    }

    const latest = await transaction.catalogMenuVersion.findFirst({
      where: { organizationId: input.organizationId, menuKey },
      select: { versionNumber: true },
      orderBy: { versionNumber: "desc" },
    });
    const products = await transaction.product.findMany({
      where: { organizationId: input.organizationId },
      orderBy: [{ categoryId: "asc" }, { groupId: "asc" }, { sortOrder: "asc" }, { id: "asc" }],
      include: {
        noteGroupAssignments: {
          where: { isActive: true },
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: {
            noteGroup: {
              include: {
                options: {
                  where: { isActive: true },
                  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                },
              },
            },
          },
        },
        bundleChoiceGroups: {
          orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
          include: {
            choices: {
              where: { isEnabled: true },
              orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
            },
          },
        },
      },
    });
    const snapshots = products.map((product) => ({
      productId: product.id,
      categoryId: product.categoryId,
      groupId: product.groupId,
      productName: product.name,
      description: product.description,
      basePriceAmount: product.defaultPrice,
      productKind: product.kind,
      sortOrder: product.sortOrder,
      isActive: product.isActive,
      modifierSnapshot: product.noteGroupAssignments.map((assignment) => ({
        id: assignment.noteGroup.id,
        name: assignment.noteGroup.name,
        selectionMode: assignment.noteGroup.selectionMode,
        isRequired: assignment.noteGroup.isRequired,
        minSelections: assignment.noteGroup.minSelections,
        maxSelections: assignment.noteGroup.maxSelections,
        options: assignment.noteGroup.options.map((option) => ({
          id: option.id,
          name: option.name,
          priceDelta: option.priceDelta,
        })),
      })),
      bundleSnapshot: product.bundleChoiceGroups.map((group) => ({
        id: group.id,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        choices: group.choices.map((choice) => ({
          productId: choice.componentProductId,
          quantity: choice.quantity,
          priceDelta: choice.priceDelta,
        })),
      })),
    }));
    const version = await transaction.catalogMenuVersion.create({
      data: {
        organizationId: input.organizationId,
        menuKey,
        name: input.name,
        versionNumber: (latest?.versionNumber ?? 0) + 1,
        sourceVersionId: sourceVersion?.id ?? null,
        createdByProfileId: input.profileId,
        checksum: snapshotChecksum(snapshots),
      },
    });
    if (snapshots.length > 0) {
      await transaction.catalogVersionItem.createMany({
        data: snapshots.map((item) => ({
          organizationId: input.organizationId,
          versionId: version.id,
          productId: item.productId,
          categoryId: item.categoryId,
          groupId: item.groupId,
          productName: item.productName,
          description: item.description,
          basePriceAmount: item.basePriceAmount,
          currency: "TWD",
          productKind: item.productKind,
          sortOrder: item.sortOrder,
          isActive: item.isActive,
          modifierSnapshot: item.modifierSnapshot,
          bundleSnapshot: item.bundleSnapshot,
        })),
      });
    }
    return version;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

export async function transitionCatalogVersion(input: {
  organizationId: string;
  versionId: string;
  profileId: string;
  nextStatus: CatalogVersionStatus;
  scheduledPublishAt?: Date | null;
}) {
  await assertHqModuleEnabled(input.organizationId);
  return prisma.$transaction(async (transaction) => {
    const current = await transaction.catalogMenuVersion.findFirst({
      where: { id: input.versionId, organizationId: input.organizationId },
    });
    if (!current) throw new CatalogVersionOperationError("CATALOG_VERSION_NOT_FOUND");
    assertCatalogVersionTransition(current.status as CatalogVersionStatus, input.nextStatus);
    if (input.nextStatus === "SCHEDULED" && !input.scheduledPublishAt) {
      throw new CatalogVersionOperationError("CATALOG_VERSION_SCHEDULE_REQUIRED");
    }

    if (input.nextStatus === "ACTIVE") {
      await transaction.catalogMenuVersion.updateMany({
        where: {
          organizationId: input.organizationId,
          menuKey: current.menuKey,
          status: "ACTIVE",
          id: { not: current.id },
        },
        data: { status: "SUPERSEDED", supersededAt: new Date() },
      });
    }

    return transaction.catalogMenuVersion.update({
      where: { id: current.id },
      data: {
        status: input.nextStatus,
        ...(input.nextStatus === "APPROVED" ? { approvedByProfileId: input.profileId } : {}),
        ...(input.nextStatus === "SCHEDULED" ? { scheduledPublishAt: input.scheduledPublishAt } : {}),
        ...(input.nextStatus === "PUBLISHING" ? { lockedAt: new Date() } : {}),
        ...(input.nextStatus === "ACTIVE" ? { publishedAt: new Date() } : {}),
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}
