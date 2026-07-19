import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { prisma } from "@/lib/prisma";
import { publicQrCacheTag, stallMenuCacheTag } from "@/lib/cache-tags";
import type { PublicMenu } from "@/lib/public-menu-types";

const QR_CONTEXT_TTL_SECONDS = 15;
const PUBLIC_MENU_TTL_SECONDS = 45;
const ACTIVE_ORGANIZATION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] as const;

type OrderingMode = "DEFAULT" | "DELIVERY";

export async function getCachedPublicMenuForQrToken(
  qrToken: string,
  orderingMode: OrderingMode = "DEFAULT",
): Promise<PublicMenu | null> {
  const qrTag = publicQrCacheTag(qrToken);
  const getQrContext = unstable_cache(
    () => loadQrContext(qrToken),
    ["public-qr-context", qrTag],
    { revalidate: QR_CONTEXT_TTL_SECONDS, tags: [qrTag] },
  );
  const context = await getQrContext();
  if (!context || !publicQrContextIsAvailable(context)) return null;

  const settings = context.stall.orderingSettings;
  if (!settings) return null;
  if (orderingMode === "DELIVERY") {
    if (context.diningTable || !settings.deliveryModuleEnabled) return null;
  } else if (context.diningTable && (!context.diningTable.isActive || !settings.dineInEnabled)) {
    return null;
  }

  const menu = await getCachedStallMenu(context.stallId);
  if (!menu) return null;

  return {
    ...menu,
    stall: {
      name: context.stall.name,
      slug: context.stall.slug,
      location: context.stall.location,
      currency: context.stall.currency,
      fulfillmentType: orderingMode === "DELIVERY"
        ? "DELIVERY"
        : context.diningTable ? "DINE_IN" : "TAKEOUT",
      table: context.diningTable
        ? { id: context.diningTable.id, code: context.diningTable.code, label: context.diningTable.label }
        : null,
    },
  };
}

export async function getCachedPublicMenuForStallSlug(stallSlug: string): Promise<PublicMenu | null> {
  const stall = await prisma.stall.findUnique({
    where: { slug: stallSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      location: true,
      currency: true,
      isActive: true,
      orderingEnabled: true,
      businessStatus: true,
      orderingState: true,
      isSoldOut: true,
      organization: { select: { status: true } },
    },
  });
  if (!stall || !publicStallIsAvailable(stall)) return null;

  const menu = await getCachedStallMenu(stall.id);
  if (!menu) return null;
  return {
    ...menu,
    stall: {
      name: stall.name,
      slug: stall.slug,
      location: stall.location,
      currency: stall.currency,
      fulfillmentType: "TAKEOUT",
      table: null,
    },
  };
}

export function invalidatePublicMenu(stallId: string) {
  revalidateTag(stallMenuCacheTag(stallId), { expire: 0 });
}

export function invalidatePublicMenus(stallIds: readonly string[]) {
  for (const stallId of new Set(stallIds)) invalidatePublicMenu(stallId);
}

export async function invalidateOrganizationPublicMenus(organizationId: string) {
  const stalls = await prisma.stall.findMany({
    where: { organizationId },
    select: { id: true },
  });
  invalidatePublicMenus(stalls.map((stall) => stall.id));
}

export function invalidatePublicQrToken(qrToken: string) {
  revalidateTag(publicQrCacheTag(qrToken), { expire: 0 });
}

async function getCachedStallMenu(stallId: string) {
  const tag = stallMenuCacheTag(stallId);
  const getMenu = unstable_cache(
    () => loadStallMenu(stallId),
    ["public-stall-menu", stallId],
    { revalidate: PUBLIC_MENU_TTL_SECONDS, tags: [tag] },
  );
  return getMenu();
}

async function loadQrContext(qrToken: string) {
  const qrCode = await prisma.qrCode.findUnique({
    where: { token: qrToken },
    select: {
      stallId: true,
      state: true,
      expiresAt: true,
      diningTable: { select: { id: true, code: true, label: true, isActive: true } },
      stall: {
        select: {
          name: true,
          slug: true,
          location: true,
          currency: true,
          isActive: true,
          orderingEnabled: true,
          businessStatus: true,
          orderingState: true,
          isSoldOut: true,
          organization: { select: { status: true } },
          orderingSettings: {
            select: { dineInEnabled: true, deliveryModuleEnabled: true },
          },
        },
      },
    },
  });
  if (!qrCode) return null;
  return {
    ...qrCode,
    expiresAt: qrCode.expiresAt?.toISOString() ?? null,
  };
}

function publicQrContextIsAvailable(context: NonNullable<Awaited<ReturnType<typeof loadQrContext>>>) {
  return context.state === "ACTIVE"
    && (!context.expiresAt || Date.parse(context.expiresAt) > Date.now())
    && publicStallIsAvailable(context.stall);
}

function publicStallIsAvailable(stall: {
  isActive: boolean;
  orderingEnabled: boolean;
  businessStatus: string;
  orderingState: string;
  isSoldOut: boolean;
  organization: { status: string };
}) {
  return stall.isActive
    && stall.orderingEnabled
    && stall.businessStatus === "OPEN"
    && stall.orderingState === "OPEN"
    && !stall.isSoldOut
    && ACTIVE_ORGANIZATION_STATUSES.includes(
      stall.organization.status as (typeof ACTIVE_ORGANIZATION_STATUSES)[number],
    );
}

async function loadStallMenu(stallId: string): Promise<Omit<PublicMenu, "stall"> | null> {
  const now = new Date();
  const [assignments, settings] = await Promise.all([
    prisma.stallProduct.findMany({
      where: {
        stallId,
        isEnabled: true,
        isSoldOut: false,
        OR: [{ availableFrom: null }, { availableFrom: { lte: now } }],
        AND: [{ OR: [{ availableUntil: null }, { availableUntil: { gt: now } }] }],
        product: { isActive: true, category: { isActive: true } },
      },
      orderBy: [{ sortOrder: "asc" }, { product: { sortOrder: "asc" } }],
      select: {
        priceOverride: true,
        sortOrder: true,
        product: {
          select: {
            id: true,
            name: true,
            description: true,
            defaultPrice: true,
            imageUrl: true,
            sortOrder: true,
            category: { select: { name: true, sortOrder: true } },
            translations: { select: { locale: true, name: true, description: true } },
            noteGroupAssignments: {
              where: { isActive: true, noteGroup: { isActive: true } },
              orderBy: [{ sortOrder: "asc" }, { noteGroup: { sortOrder: "asc" } }],
              select: {
                sortOrder: true,
                noteGroup: {
                  select: {
                    id: true,
                    name: true,
                    selectionMode: true,
                    isRequired: true,
                    minSelections: true,
                    maxSelections: true,
                    sortOrder: true,
                    translations: { select: { locale: true, name: true } },
                    options: {
                      where: { isActive: true },
                      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
                      select: {
                        id: true,
                        name: true,
                        priceDelta: true,
                        sortOrder: true,
                        translations: { select: { locale: true, name: true } },
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
    prisma.stallOrderingSettings.findUnique({
      where: { stallId },
      select: {
        maxItemQuantity: true,
        maxUniqueProducts: true,
        maxTotalQuantity: true,
        maxNoteLength: true,
        enabledLocales: true,
        estimatedWaitMinutes: true,
      },
    }),
  ]);
  if (!settings) return null;

  return {
    products: assignments.map((assignment) => ({
      id: assignment.product.id,
      name: assignment.product.name,
      description: assignment.product.description,
      imageUrl: assignment.product.imageUrl,
      translations: assignment.product.translations,
      noteGroups: assignment.product.noteGroupAssignments.map((assignmentItem) => ({
        id: assignmentItem.noteGroup.id,
        name: assignmentItem.noteGroup.name,
        selectionMode: assignmentItem.noteGroup.selectionMode,
        isRequired: assignmentItem.noteGroup.isRequired,
        minSelections: assignmentItem.noteGroup.minSelections,
        maxSelections: assignmentItem.noteGroup.maxSelections,
        sortOrder: assignmentItem.sortOrder || assignmentItem.noteGroup.sortOrder,
        translations: assignmentItem.noteGroup.translations,
        options: assignmentItem.noteGroup.options,
      })),
      price: assignment.priceOverride ?? assignment.product.defaultPrice,
      category: assignment.product.category.name,
      categorySortOrder: assignment.product.category.sortOrder,
      productSortOrder: assignment.sortOrder || assignment.product.sortOrder,
    })).sort((left, right) => (
      left.categorySortOrder - right.categorySortOrder
      || left.productSortOrder - right.productSortOrder
    )).map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      translations: product.translations,
      noteGroups: product.noteGroups,
      price: product.price,
      category: product.category,
    })),
    supportedLocales: settings.enabledLocales,
    estimatedWaitMinutes: settings.estimatedWaitMinutes,
    lastTableOrderAt: null,
    limits: {
      maxItemQuantity: settings.maxItemQuantity,
      maxUniqueProducts: settings.maxUniqueProducts,
      maxTotalQuantity: settings.maxTotalQuantity,
      maxNoteLength: settings.maxNoteLength,
    },
  };
}
