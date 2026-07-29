import "server-only";

import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { publishImmutableStorageObject } from "@/server/resilience/storage-replication-service";

const ACTIVE_ORGANIZATION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] as const;

type JsonPrimitive = string | number | boolean | null;
type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

function canonicalJson(value: JsonValue): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  return `{${Object.keys(value).sort().map(
    (key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`,
  ).join(",")}}`;
}

export function hashOfflineMenuCatalog(catalog: JsonValue) {
  return createHash("sha256").update(canonicalJson(catalog)).digest("hex");
}

export function buildPublicOfflineMenuCatalog<
  Category extends { id: string; isActive: boolean },
  Group extends { id: string; isActive: boolean },
  Option extends { isActive: boolean },
  NoteGroup extends { isActive: boolean; options: Option[] },
  Product extends {
    categoryId: string;
    groupId: string | null;
    isActive: boolean;
    isEnabled: boolean;
    noteGroups: NoteGroup[];
  },
  Catalog extends {
    categories: Category[];
    groups: Group[];
    products: Product[];
  },
>(catalog: Catalog) {
  const categories = new Map(catalog.categories.map((category) => [category.id, category]));
  const groups = new Map(catalog.groups.map((group) => [group.id, group]));
  const products = catalog.products
    .filter((product) => {
      const category = categories.get(product.categoryId);
      const group = product.groupId ? groups.get(product.groupId) : null;
      return product.isActive
        && product.isEnabled
        && Boolean(category?.isActive)
        && (!group || group.isActive);
    })
    .map((product) => ({
      ...product,
      noteGroups: product.noteGroups
        .filter((noteGroup) => noteGroup.isActive)
        .map((noteGroup) => ({
          ...noteGroup,
          options: noteGroup.options.filter((option) => option.isActive),
        })),
    }));
  const categoryIds = new Set(products.map((product) => product.categoryId));
  const groupIds = new Set(
    products.flatMap((product) => product.groupId ? [product.groupId] : []),
  );
  return {
    ...catalog,
    categories: catalog.categories.filter((category) => categoryIds.has(category.id)),
    groups: catalog.groups.filter((group) => groupIds.has(group.id)),
    products,
  };
}

export async function createOrReuseOfflineMenuSnapshot(input: {
  organizationId: string;
  stallId: string;
  minimumExpiresAt: Date;
  includeManualPayment: boolean;
}) {
  const result = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`
      select pg_advisory_xact_lock(
        hashtextextended(${`offline-menu:${input.stallId}`}, 0)
      )::text
    `;

    const [stall, assignments, paymentOptions] = await Promise.all([
      transaction.stall.findFirst({
        where: {
          id: input.stallId,
          organizationId: input.organizationId,
          isActive: true,
          organization: { status: { in: [...ACTIVE_ORGANIZATION_STATUSES] } },
        },
        select: {
          id: true,
          name: true,
          slug: true,
          currency: true,
          timezone: true,
          businessStatus: true,
          orderingEnabled: true,
          orderingState: true,
          isSoldOut: true,
          orderingSettings: {
            select: {
              maxItemQuantity: true,
              maxUniqueProducts: true,
              maxTotalQuantity: true,
              maxNoteLength: true,
              printModuleEnabled: true,
              paymentModuleEnabled: true,
              enabledLocales: true,
            },
          },
        },
      }),
      transaction.stallProduct.findMany({
        where: {
          organizationId: input.organizationId,
          stallId: input.stallId,
        },
        orderBy: [
          { product: { category: { sortOrder: "asc" } } },
          { sortOrder: "asc" },
          { product: { sortOrder: "asc" } },
        ],
        select: {
          priceOverride: true,
          isEnabled: true,
          isSoldOut: true,
          availableFrom: true,
          availableUntil: true,
          sortOrder: true,
          product: {
            select: {
              id: true,
              name: true,
              description: true,
              defaultPrice: true,
              imageUrl: true,
              isActive: true,
              sortOrder: true,
              category: {
                select: {
                  id: true,
                  name: true,
                  sortOrder: true,
                  isActive: true,
                },
              },
              group: {
                select: {
                  id: true,
                  name: true,
                  sortOrder: true,
                  isActive: true,
                },
              },
              translations: {
                select: { locale: true, name: true, description: true },
                orderBy: { locale: "asc" },
              },
              noteGroupAssignments: {
                orderBy: [{ sortOrder: "asc" }, { noteGroup: { sortOrder: "asc" } }],
                select: {
                  sortOrder: true,
                  isActive: true,
                  noteGroup: {
                    select: {
                      id: true,
                      name: true,
                      selectionMode: true,
                      isRequired: true,
                      minSelections: true,
                      maxSelections: true,
                      sortOrder: true,
                      isActive: true,
                      translations: {
                        select: { locale: true, name: true },
                        orderBy: { locale: "asc" },
                      },
                      options: {
                        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                        select: {
                          id: true,
                          name: true,
                          priceDelta: true,
                          sortOrder: true,
                          isActive: true,
                          translations: {
                            select: { locale: true, name: true },
                            orderBy: { locale: "asc" },
                          },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      }),
      transaction.paymentOption.findMany({
        where: {
          organizationId: input.organizationId,
          stallId: input.stallId,
          isEnabled: true,
          kind: { in: input.includeManualPayment ? ["CASH", "CUSTOM"] : ["CASH"] },
        },
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
        select: {
          id: true,
          code: true,
          name: true,
          kind: true,
          sortOrder: true,
        },
      }),
    ]);

    if (!stall || !stall.orderingSettings) throw new Error("OFFLINE_STALL_NOT_AVAILABLE");
    const enabledLocales = new Set(stall.orderingSettings.enabledLocales);
    const categories = new Map<string, {
      id: string;
      name: string;
      sortOrder: number;
      isActive: boolean;
    }>();
    const groups = new Map<string, {
      id: string;
      categoryId: string;
      name: string;
      sortOrder: number;
      isActive: boolean;
    }>();

    const products = assignments.map((assignment) => {
      const product = assignment.product;
      categories.set(product.category.id, {
        id: product.category.id,
        name: product.category.name,
        sortOrder: product.category.sortOrder,
        isActive: product.category.isActive,
      });
      if (product.group) {
        groups.set(product.group.id, {
          id: product.group.id,
          categoryId: product.category.id,
          name: product.group.name,
          sortOrder: product.group.sortOrder,
          isActive: product.group.isActive,
        });
      }

      return {
        id: product.id,
        categoryId: product.category.id,
        groupId: product.group?.id ?? null,
        name: product.name,
        description: product.description,
        imageUrl: product.imageUrl,
        price: assignment.priceOverride ?? product.defaultPrice,
        isActive: product.isActive,
        isEnabled: assignment.isEnabled,
        isSoldOut: assignment.isSoldOut,
        availableFrom: assignment.availableFrom?.toISOString() ?? null,
        availableUntil: assignment.availableUntil?.toISOString() ?? null,
        sortOrder: assignment.sortOrder || product.sortOrder,
        translations: product.translations.filter(
          (translation) => enabledLocales.has(translation.locale),
        ),
        noteGroups: product.noteGroupAssignments.map((noteAssignment) => ({
          id: noteAssignment.noteGroup.id,
          name: noteAssignment.noteGroup.name,
          selectionMode: noteAssignment.noteGroup.selectionMode,
          isRequired: noteAssignment.noteGroup.isRequired,
          minSelections: noteAssignment.noteGroup.minSelections,
          maxSelections: noteAssignment.noteGroup.maxSelections,
          sortOrder: noteAssignment.sortOrder || noteAssignment.noteGroup.sortOrder,
          isActive: noteAssignment.isActive && noteAssignment.noteGroup.isActive,
          translations: noteAssignment.noteGroup.translations.filter(
            (translation) => enabledLocales.has(translation.locale),
          ),
          options: noteAssignment.noteGroup.options.map((option) => ({
            ...option,
            translations: option.translations.filter(
              (translation) => enabledLocales.has(translation.locale),
            ),
          })),
        })),
      };
    });

    const catalog = {
      schemaVersion: 1,
      stall: {
        id: stall.id,
        name: stall.name,
        slug: stall.slug,
        currency: stall.currency,
        timezone: stall.timezone,
        businessStatus: stall.businessStatus,
        orderingEnabled: stall.orderingEnabled,
        orderingState: stall.orderingState,
        isSoldOut: stall.isSoldOut,
      },
      limits: {
        maxItemQuantity: stall.orderingSettings.maxItemQuantity,
        maxUniqueProducts: stall.orderingSettings.maxUniqueProducts,
        maxTotalQuantity: stall.orderingSettings.maxTotalQuantity,
        maxNoteLength: stall.orderingSettings.maxNoteLength,
      },
      modules: {
        print: stall.orderingSettings.printModuleEnabled,
        payment: stall.orderingSettings.paymentModuleEnabled,
      },
      supportedLocales: stall.orderingSettings.enabledLocales,
      categories: [...categories.values()].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
      ),
      groups: [...groups.values()].sort(
        (left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name),
      ),
      products,
      paymentOptions,
    } satisfies JsonValue;
    const publicCatalog = buildPublicOfflineMenuCatalog(catalog) satisfies JsonValue;
    const contentHash = hashOfflineMenuCatalog(catalog);
    const publicContentHash = hashOfflineMenuCatalog(publicCatalog);

    const reusable = await transaction.menuSnapshot.findFirst({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        contentHash,
        expiresAt: { gte: input.minimumExpiresAt },
      },
      orderBy: { version: "desc" },
    });
    if (reusable) return { snapshot: reusable, catalog, publicCatalog };

    const latest = await transaction.menuSnapshot.findFirst({
      where: {
        organizationId: input.organizationId,
        stallId: input.stallId,
      },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    const generatedAt = new Date();
    const expiresAt = new Date(Math.max(
      generatedAt.getTime() + 12 * 60 * 60_000,
      input.minimumExpiresAt.getTime() + 5 * 60_000,
    ));
    const version = (latest?.version ?? 0) + 1;
    const publicObjectPath = `${input.organizationId}/${input.stallId}/${version}-${publicContentHash}.json`;
    const snapshot = await transaction.menuSnapshot.create({
      data: {
        organizationId: input.organizationId,
        stallId: input.stallId,
        version,
        contentHash,
        publicContentHash,
        publicObjectPath,
        catalogJson: catalog as Prisma.InputJsonObject,
        currency: stall.currency,
        generatedAt,
        expiresAt,
      },
    });
    return { snapshot, catalog, publicCatalog };
  }, { isolationLevel: "Serializable" });

  const publicDocument = {
    schemaVersion: 1,
    snapshot: {
      version: result.snapshot.version,
      contentHash: result.snapshot.publicContentHash,
      generatedAt: result.snapshot.generatedAt.toISOString(),
      expiresAt: result.snapshot.expiresAt.toISOString(),
    },
    catalog: result.publicCatalog,
  } satisfies JsonValue;
  const bytes = new TextEncoder().encode(canonicalJson(publicDocument));
  const publication = await publishImmutableStorageObject({
    organizationId: input.organizationId,
    bucket: "offline-menu-snapshots",
    objectPath: result.snapshot.publicObjectPath,
    contentType: "application/json",
    bytes,
  });
  if (publication.checksum !== hashOfflineMenuCatalog(publicDocument)) {
    throw new Error("OFFLINE_MENU_PUBLICATION_CHECKSUM_MISMATCH");
  }

  return {
    snapshot: result.snapshot,
    catalog: result.catalog,
    publicSnapshot: {
      contentHash: result.snapshot.publicContentHash,
      objectPath: result.snapshot.publicObjectPath,
      path: `/api/assets/offline-menus/${result.snapshot.publicObjectPath}`,
    },
  };
}
