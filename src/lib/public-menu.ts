import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import { calculateCapacitySnapshot } from "@/lib/capacity";
import { prisma } from "@/lib/prisma";
import {
  compareConfiguredProductOrder,
  UNGROUPED_PRODUCT_SORT_ORDER,
} from "@/lib/configured-product-order";
import { publicQrCacheTag, stallMenuCacheTag } from "@/lib/cache-tags";
import type { PublicMenu } from "@/lib/public-menu-types";
import {
  dateInTimeZone,
  filterPreorderSlotsForSpecialClosures,
  serializeSpecialClosure,
  type SpecialClosureView,
} from "@/lib/special-closures";
import {
  publicMenuProductsForPickup,
  publicMenuProductsForPickupWindow,
} from "@/lib/public-menu-availability";
import {
  applyBestSellerRanking,
  type BestSellerRankRow,
} from "../../supabase/functions/_shared/bestseller-ranking";
import { completeCatalogLocales } from "../../supabase/functions/_shared/catalog-locale-completeness";
import { getPublicEInvoiceCheckoutConfig } from "@/server/e-invoice/checkout-preference-service";

const QR_CONTEXT_TTL_SECONDS = 15;
const PUBLIC_MENU_TTL_SECONDS = 45;
const ACTIVE_ORGANIZATION_STATUSES = ["TRIALING", "ACTIVE", "PAST_DUE", "GRACE_PERIOD"] as const;

export const completePublicMenuLocales = completeCatalogLocales;

type OrderingMode = "DEFAULT" | "DELIVERY" | "PREORDER";
type PublicQrMenuOptions = { includeOptionalPreorderSlots?: boolean };

export async function getCachedPublicMenuForQrToken(
  qrToken: string,
  orderingMode: OrderingMode = "DEFAULT",
  options: PublicQrMenuOptions = {},
): Promise<PublicMenu | null> {
  const qrTag = publicQrCacheTag(qrToken);
  const getQrContext = unstable_cache(
    () => loadQrContext(qrToken),
    ["public-qr-context", qrTag],
    { revalidate: QR_CONTEXT_TTL_SECONDS, tags: [qrTag] },
  );
  const context = await getQrContext();
  if (!context) return null;

  const liveOrderingAvailable = publicQrContextIsLive(context);
  const preorderAvailable = publicQrContextSupportsPreorder(context);
  const resolvedOrderingMode: OrderingMode = orderingMode;
  if (resolvedOrderingMode === "PREORDER" ? !preorderAvailable : !liveOrderingAvailable) {
    return null;
  }

  if (
    (resolvedOrderingMode === "DELIVERY" && context.fulfillmentTypeContext && context.fulfillmentTypeContext !== "DELIVERY")
    || (resolvedOrderingMode !== "DELIVERY" && context.fulfillmentTypeContext === "DELIVERY")
  ) return null;

  const settings = context.stall.orderingSettings;
  if (!settings) return null;
  if (resolvedOrderingMode === "DELIVERY") {
    if (context.diningTable || !settings.deliveryModuleEnabled) return null;
  } else if (resolvedOrderingMode === "DEFAULT" && context.diningTable && (
    !context.diningTable.isActive || !settings.dineInEnabled
  )) {
    return null;
  }

  const supportsRequestedFulfillmentTime = !context.diningTable
    && context.fulfillmentTypeContext !== "DINE_IN"
    && (resolvedOrderingMode === "DELIVERY"
      ? settings.deliveryModuleEnabled
      : settings.takeoutPreorderEnabled);

  const [menu, capacity, rawPreorderSlots, specialClosures, invoiceCheckout] = await Promise.all([
    getCachedStallMenu(context.stallId),
    resolvedOrderingMode === "PREORDER"
      ? Promise.resolve(null)
      : calculateCapacitySnapshot(context.stallId),
    supportsRequestedFulfillmentTime
      && (resolvedOrderingMode === "PREORDER" || options.includeOptionalPreorderSlots !== false)
      ? getTakeoutPreorderSlots(context.stallId)
      : Promise.resolve([]),
    getPublicSpecialClosures(context.stallId, context.stall.timezone),
    getPublicEInvoiceCheckoutConfig(context.stallId),
  ]);
  if (!menu || (resolvedOrderingMode === "PREORDER" && rawPreorderSlots.length === 0)) return null;
  const preorderSlots = filterPreorderSlotsForSpecialClosures(
    rawPreorderSlots,
    specialClosures,
    context.stall.timezone,
  );
  const specialClosure = publicSpecialClosureAnnouncement(
    specialClosures,
    context.stall.timezone,
  );
  const products = resolvedOrderingMode === "PREORDER"
    ? publicMenuProductsForPickupWindow(menu.products, preorderSlots)
    : publicMenuProductsForPickup(menu.products, new Date().toISOString());

  return {
    ...menu,
    products,
    orderingMode: resolvedOrderingMode,
    preorderSlots,
    lotteryEnabled: resolvedOrderingMode === "DEFAULT" && settings.lotteryEnabled,
    lotteryReward: {
      spendEnabled: settings.lotterySpendRewardEnabled,
      spendThresholdAmount: settings.lotterySpendThresholdAmount,
      festivalEnabled: settings.lotteryFestivalRewardEnabled,
      festivalActive: lotteryFestivalIsActive(settings, context.stall.timezone),
    },
    specialClosure,
    ...(invoiceCheckout ? { invoiceCheckout } : {}),
    estimatedWaitMinutes: capacity?.quoteMaxMinutes ?? 0,
    estimatedWaitMinMinutes: capacity?.quoteMinMinutes ?? 0,
    estimatedWaitMaxMinutes: capacity?.quoteMaxMinutes ?? 0,
    waitAcknowledgmentThresholdMinutes: resolvedOrderingMode === "PREORDER"
      ? null
      : capacity?.acknowledgmentThresholdMinutes ?? null,
    requiresWaitAcknowledgment: resolvedOrderingMode === "PREORDER"
      ? false
      : capacity?.requiresAcknowledgment === true,
    stall: {
      name: context.stall.name,
      slug: context.stall.slug,
      location: context.location?.name ?? context.stall.location,
      address: context.stall.address,
      currency: context.stall.currency,
      timezone: context.stall.timezone,
      coverImageUrl: context.stall.coverImageUrl,
      locationGuideImageUrl: context.stall.locationGuideImageUrl,
      coverImagePositionX: context.stall.coverImagePositionX,
      coverImagePositionY: context.stall.coverImagePositionY,
      coverImageZoom: context.stall.coverImageZoom,
      fulfillmentType: context.fulfillmentTypeContext
        ?? (resolvedOrderingMode === "DELIVERY" ? "DELIVERY" : context.diningTable ? "DINE_IN" : "TAKEOUT"),
      table: context.diningTable
        ? { id: context.diningTable.id, code: context.diningTable.code, label: context.diningTable.label }
        : null,
    },
  };
}

export async function getCachedPublicMenuForStallSlug(stallSlug: string): Promise<PublicMenu | null> {
  const stall = await findPublicStallBySlug(stallSlug);
  if (!stall || !publicStallIsAvailable(stall)) return null;

  const [menu, capacity, specialClosure, invoiceCheckout] = await Promise.all([
    getCachedStallMenu(stall.id),
    calculateCapacitySnapshot(stall.id),
    getPublicSpecialClosure(stall.id, stall.timezone),
    getPublicEInvoiceCheckoutConfig(stall.id),
  ]);
  if (!menu) return null;
  return {
    ...menu,
    products: publicMenuProductsForPickup(menu.products, new Date().toISOString()),
    orderingMode: "DELIVERY",
    preorderSlots: [],
    lotteryEnabled: false,
    specialClosure,
    ...(invoiceCheckout ? { invoiceCheckout } : {}),
    estimatedWaitMinutes: capacity.quoteMaxMinutes,
    estimatedWaitMinMinutes: capacity.quoteMinMinutes,
    estimatedWaitMaxMinutes: capacity.quoteMaxMinutes,
    waitAcknowledgmentThresholdMinutes: capacity.acknowledgmentThresholdMinutes,
    requiresWaitAcknowledgment: capacity.requiresAcknowledgment,
    stall: {
      name: stall.name,
      slug: stall.slug,
      location: stall.location,
      address: stall.address,
      currency: stall.currency,
      timezone: stall.timezone,
      coverImageUrl: stall.coverImageUrl,
      locationGuideImageUrl: stall.locationGuideImageUrl,
      coverImagePositionX: stall.coverImagePositionX,
      coverImagePositionY: stall.coverImagePositionY,
      coverImageZoom: stall.coverImageZoom,
      fulfillmentType: "TAKEOUT",
      table: null,
    },
  };
}

export async function getCachedPublicDisplayMenuForStallSlug(
  stallSlug: string,
): Promise<PublicMenu | null> {
  return getPublicDisplayMenuForStallSlug(stallSlug, getCachedStallMenu);
}

export async function getLivePublicDisplayMenuForStallSlug(
  stallSlug: string,
): Promise<PublicMenu | null> {
  return getPublicDisplayMenuForStallSlug(stallSlug, loadStallMenu);
}

async function getPublicDisplayMenuForStallSlug(
  stallSlug: string,
  menuLoader: (
    stallId: string,
  ) => Promise<Omit<PublicMenu, "stall" | "orderingMode" | "preorderSlots" | "lotteryEnabled"> | null>,
): Promise<PublicMenu | null> {
  const stall = await findPublicStallBySlug(stallSlug);
  if (!stall || !publicStallCanDisplayMenu(stall)) return null;

  const [menu, specialClosure] = await Promise.all([
    menuLoader(stall.id),
    getPublicSpecialClosure(stall.id, stall.timezone),
  ]);
  if (!menu) return null;
  return {
    ...menu,
    orderingMode: "DEFAULT",
    preorderSlots: [],
    lotteryEnabled: false,
    specialClosure,
    stall: {
      name: stall.name,
      slug: stall.slug,
      location: stall.location,
      address: stall.address,
      currency: stall.currency,
      timezone: stall.timezone,
      coverImageUrl: stall.coverImageUrl,
      locationGuideImageUrl: stall.locationGuideImageUrl,
      coverImagePositionX: stall.coverImagePositionX,
      coverImagePositionY: stall.coverImagePositionY,
      coverImageZoom: stall.coverImageZoom,
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

async function findPublicStallBySlug(stallSlug: string) {
  return prisma.stall.findUnique({
    where: { slug: stallSlug },
    select: {
      id: true,
      name: true,
      slug: true,
      location: true,
      address: true,
      currency: true,
      timezone: true,
      coverImageUrl: true,
      locationGuideImageUrl: true,
      coverImagePositionX: true,
      coverImagePositionY: true,
      coverImageZoom: true,
      isActive: true,
      orderingEnabled: true,
      businessStatus: true,
      orderingState: true,
      isSoldOut: true,
      organization: { select: { status: true } },
    },
  });
}

async function loadQrContext(qrToken: string) {
  const qrCode = await prisma.qrCode.findUnique({
    where: { token: qrToken },
    select: {
      stallId: true,
      state: true,
      expiresAt: true,
      fulfillmentTypeContext: true,
      diningTable: { select: { id: true, code: true, label: true, isActive: true } },
      location: { select: { name: true, isActive: true } },
      marketEvent: { select: { startsAt: true, endsAt: true } },
      stallSchedule: {
        select: {
          status: true,
          startsAt: true,
          endsAt: true,
          orderingOpensAt: true,
          orderingClosesAt: true,
        },
      },
      stall: {
        select: {
          name: true,
          slug: true,
          location: true,
          address: true,
          currency: true,
          timezone: true,
          coverImageUrl: true,
          locationGuideImageUrl: true,
          coverImagePositionX: true,
          coverImagePositionY: true,
          coverImageZoom: true,
          isActive: true,
          orderingEnabled: true,
          businessStatus: true,
          orderingState: true,
          isSoldOut: true,
          organization: { select: { status: true } },
          orderingSettings: {
            select: {
              dineInEnabled: true,
              deliveryModuleEnabled: true,
              takeoutPreorderEnabled: true,
              lotteryEnabled: true,
              lotterySpendRewardEnabled: true,
              lotterySpendThresholdAmount: true,
              lotteryFestivalRewardEnabled: true,
              lotteryFestivalStartsOn: true,
              lotteryFestivalEndsOn: true,
            },
          },
        },
      },
    },
  });
  if (!qrCode) return null;
  return {
    ...qrCode,
    expiresAt: qrCode.expiresAt?.toISOString() ?? null,
    marketEvent: qrCode.marketEvent ? {
      startsAt: qrCode.marketEvent.startsAt.toISOString(),
      endsAt: qrCode.marketEvent.endsAt.toISOString(),
    } : null,
    stallSchedule: qrCode.stallSchedule ? {
      ...qrCode.stallSchedule,
      startsAt: qrCode.stallSchedule.startsAt.toISOString(),
      endsAt: qrCode.stallSchedule.endsAt.toISOString(),
      orderingOpensAt: qrCode.stallSchedule.orderingOpensAt?.toISOString() ?? null,
      orderingClosesAt: qrCode.stallSchedule.orderingClosesAt?.toISOString() ?? null,
    } : null,
  };
}

function publicQrBaseIsAvailable(context: NonNullable<Awaited<ReturnType<typeof loadQrContext>>>) {
  return context.state === "ACTIVE"
    && (!context.expiresAt || Date.parse(context.expiresAt) > Date.now())
    && (!context.location || context.location.isActive)
    && context.stall.isActive
    && !context.stall.isSoldOut
    && ACTIVE_ORGANIZATION_STATUSES.includes(
      context.stall.organization.status as (typeof ACTIVE_ORGANIZATION_STATUSES)[number],
    );
}

function publicQrContextIsLive(context: NonNullable<Awaited<ReturnType<typeof loadQrContext>>>) {
  const now = Date.now();
  const schedule = context.stallSchedule;
  const event = context.marketEvent;
  return publicQrBaseIsAvailable(context)
    && (!schedule || (
      schedule.status === "OPEN"
      && Date.parse(schedule.orderingOpensAt ?? schedule.startsAt) <= now
      && Date.parse(schedule.orderingClosesAt ?? schedule.endsAt) > now
    ))
    && (!event || (
      Date.parse(event.endsAt) > now
      && (schedule || Date.parse(event.startsAt) <= now)
    ))
    && publicStallIsAvailable(context.stall);
}

function publicQrContextSupportsPreorder(
  context: NonNullable<Awaited<ReturnType<typeof loadQrContext>>>,
) {
  return publicQrBaseIsAvailable(context)
    && context.stall.orderingSettings?.takeoutPreorderEnabled === true
    && context.stall.businessStatus !== "PAUSED"
    && context.stall.orderingState !== "PAUSED"
    && !context.diningTable
    && !context.marketEvent
    && !context.stallSchedule
    && context.fulfillmentTypeContext !== "DINE_IN"
    && context.fulfillmentTypeContext !== "DELIVERY";
}

async function getTakeoutPreorderSlots(stallId: string) {
  const rows = await prisma.$queryRaw<Array<{ slots: unknown }>>`
    select public.get_takeout_preorder_slots(${stallId}::uuid, now()) as slots
  `;
  const slots = rows[0]?.slots;
  return Array.isArray(slots)
    ? slots.filter((slot): slot is string => typeof slot === "string")
    : [];
}

async function getPublicSpecialClosure(stallId: string, timeZone: string) {
  return publicSpecialClosureAnnouncement(
    await getPublicSpecialClosures(stallId, timeZone),
    timeZone,
  );
}

async function getPublicSpecialClosures(stallId: string, timeZone: string) {
  const localDate = dateInTimeZone(new Date(), timeZone);
  const closures = await prisma.stallSpecialClosure.findMany({
    where: {
      stallId,
      endsOn: { gte: new Date(`${localDate}T00:00:00.000Z`) },
    },
    orderBy: [{ startsOn: "asc" }, { createdAt: "asc" }],
    select: { id: true, startsOn: true, endsOn: true, title: true, message: true },
  });
  return closures.map(serializeSpecialClosure);
}

function publicSpecialClosureAnnouncement(
  closures: readonly SpecialClosureView[],
  timeZone: string,
) {
  const serialized = closures[0];
  if (!serialized) return null;
  const localDate = dateInTimeZone(new Date(), timeZone);
  return {
    ...serialized,
    isActive: serialized.startsOn <= localDate && serialized.endsOn >= localDate,
  };
}

function lotteryFestivalIsActive(settings: {
  lotteryFestivalRewardEnabled: boolean;
  lotteryFestivalStartsOn: Date | null;
  lotteryFestivalEndsOn: Date | null;
}, timeZone: string) {
  if (!settings.lotteryFestivalRewardEnabled
      || !settings.lotteryFestivalStartsOn
      || !settings.lotteryFestivalEndsOn) return false;
  const businessDate = dateInTimeZone(new Date(), timeZone);
  const startsOn = settings.lotteryFestivalStartsOn.toISOString().slice(0, 10);
  const endsOn = settings.lotteryFestivalEndsOn.toISOString().slice(0, 10);
  return startsOn <= businessDate && businessDate <= endsOn;
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

function publicStallCanDisplayMenu(stall: {
  isActive: boolean;
  organization: { status: string };
}) {
  return stall.isActive
    && ACTIVE_ORGANIZATION_STATUSES.includes(
      stall.organization.status as (typeof ACTIVE_ORGANIZATION_STATUSES)[number],
    );
}

async function loadStallMenu(
  stallId: string,
): Promise<Omit<PublicMenu, "stall" | "orderingMode" | "preorderSlots" | "lotteryEnabled"> | null> {
  const [assignments, settings, bestSellerRanks] = await Promise.all([
    prisma.stallProduct.findMany({
      where: {
        stallId,
        product: {
          category: { isActive: true },
          OR: [{ groupId: null }, { group: { isActive: true } }],
        },
      },
      orderBy: [{ sortOrder: "asc" }, { product: { sortOrder: "asc" } }],
      select: {
        isEnabled: true,
        isSoldOut: true,
        priceOverride: true,
        sortOrder: true,
        availableFrom: true,
        availableUntil: true,
        product: {
          select: {
            id: true,
            organizationId: true,
            name: true,
            description: true,
            defaultPrice: true,
            kind: true,
            imageUrl: true,
            isActive: true,
            isOrderDiscountEligible: true,
            sortOrder: true,
            category: {
              select: {
                name: true,
                sortOrder: true,
                translations: { select: { locale: true, name: true } },
              },
            },
            group: {
              select: {
                name: true,
                sortOrder: true,
                translations: { select: { locale: true, name: true } },
              },
            },
            translations: { select: { locale: true, name: true, description: true } },
            bundleChoiceGroups: {
              orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
              select: {
                id: true,
                organizationId: true,
                name: true,
                minSelections: true,
                maxSelections: true,
                sortOrder: true,
                choices: {
                  where: { isEnabled: true },
                  orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
                  select: {
                    id: true,
                    organizationId: true,
                    componentProductId: true,
                    quantity: true,
                    priceDelta: true,
                    sortOrder: true,
                    componentProduct: {
                      select: {
                        id: true,
                        organizationId: true,
                        name: true,
                        kind: true,
                        isActive: true,
                      },
                    },
                  },
                },
              },
            },
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
    prisma.$queryRaw<BestSellerRankRow[]>`
      select product_id, rank
      from public.get_stall_best_sellers(${stallId}::uuid)
    `,
  ]);
  if (!settings) return null;

  const displayedAssignments = assignments.filter((assignment) => (
    assignment.isEnabled || !assignment.product.isActive
  ));
  const saleableProductIds = new Set(assignments.flatMap((assignment) => (
    assignment.isEnabled && !assignment.isSoldOut && assignment.product.isActive
      ? [assignment.product.id]
      : []
  )));
  const assignmentsByProductId = new Map(
    assignments.map((assignment) => [assignment.product.id, assignment]),
  );
  const publicProducts = displayedAssignments.flatMap((assignment) => {
    const product = assignment.product;
    const isSoldOut = assignment.isSoldOut || !product.isActive;
    const bundleChoiceGroups = product.kind === "BUNDLE"
      ? product.bundleChoiceGroups.map((group) => ({
        id: group.id,
        organizationId: group.organizationId,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        sortOrder: group.sortOrder,
        options: group.choices.flatMap((choice) => (
          assignmentsByProductId.has(choice.componentProductId)
          && (
          choice.organizationId === product.organizationId
          && choice.componentProduct.organizationId === product.organizationId
          && choice.componentProduct.kind === "SINGLE"
          && choice.componentProduct.isActive
          && saleableProductIds.has(choice.componentProductId)
          )
            ? [{
              id: choice.id,
              componentProductId: choice.componentProductId,
              componentProductName: choice.componentProduct.name,
              quantity: choice.quantity,
              priceDelta: choice.priceDelta,
              sortOrder: choice.sortOrder,
              availableFrom: assignmentsByProductId.get(choice.componentProductId)
                ?.availableFrom?.toISOString() ?? null,
              availableUntil: assignmentsByProductId.get(choice.componentProductId)
                ?.availableUntil?.toISOString() ?? null,
            }]
            : []
        )),
      }))
      : [];

    if (!isSoldOut && product.kind === "BUNDLE" && (
      bundleChoiceGroups.length === 0
      || bundleChoiceGroups.some((group) => (
        group.organizationId !== product.organizationId
        || group.options.length < group.minSelections
      ))
    )) return [];

    return [{
      assignment,
      isSoldOut,
      bundleChoiceGroups: bundleChoiceGroups.map((group) => ({
        id: group.id,
        name: group.name,
        minSelections: group.minSelections,
        maxSelections: group.maxSelections,
        sortOrder: group.sortOrder,
        options: group.options,
      })),
    }];
  });

  const menuProducts = applyBestSellerRanking(publicProducts.map(({ assignment, isSoldOut, bundleChoiceGroups }) => ({
      id: assignment.product.id,
      name: assignment.product.name,
      description: assignment.product.description,
      imageUrl: assignment.product.imageUrl,
      availableFrom: assignment.availableFrom?.toISOString() ?? null,
      availableUntil: assignment.availableUntil?.toISOString() ?? null,
      translations: assignment.product.translations,
      kind: assignment.product.kind,
      isSoldOut,
      isOrderDiscountEligible: assignment.product.isOrderDiscountEligible,
      bundleChoiceGroups,
      noteGroups: assignment.product.noteGroupAssignments.map((assignmentItem) => ({
        id: assignmentItem.noteGroup.id,
        name: assignmentItem.noteGroup.name,
        selectionMode: assignmentItem.noteGroup.selectionMode,
        isRequired: assignmentItem.noteGroup.isRequired,
        minSelections: assignmentItem.noteGroup.minSelections,
        maxSelections: assignmentItem.noteGroup.maxSelections,
        sortOrder: assignmentItem.sortOrder,
        translations: assignmentItem.noteGroup.translations,
        options: assignmentItem.noteGroup.options,
      })),
      price: assignment.priceOverride ?? assignment.product.defaultPrice,
      category: assignment.product.category.name,
      categoryTranslations: assignment.product.category.translations,
      categorySortOrder: assignment.product.category.sortOrder,
      group: assignment.product.group?.name ?? null,
      groupTranslations: assignment.product.group?.translations ?? [],
      groupSortOrder: assignment.product.group?.sortOrder ?? UNGROUPED_PRODUCT_SORT_ORDER,
      productSortOrder: assignment.product.sortOrder,
      stallProductSortOrder: assignment.sortOrder,
    })).sort(compareConfiguredProductOrder).map((product) => ({
      id: product.id,
      name: product.name,
      description: product.description,
      imageUrl: product.imageUrl,
      availableFrom: product.availableFrom,
      availableUntil: product.availableUntil,
      translations: product.translations,
      kind: product.kind,
      isSoldOut: product.isSoldOut,
      isOrderDiscountEligible: product.isOrderDiscountEligible,
      bundleChoiceGroups: product.bundleChoiceGroups,
      noteGroups: product.noteGroups,
      price: product.price,
      category: product.category,
      categoryTranslations: product.categoryTranslations,
      group: product.group,
      groupTranslations: product.groupTranslations,
    })), bestSellerRanks);

  return {
    products: menuProducts,
    supportedLocales: completePublicMenuLocales(menuProducts, settings.enabledLocales),
    estimatedWaitMinutes: settings.estimatedWaitMinutes,
    estimatedWaitMinMinutes: settings.estimatedWaitMinutes,
    estimatedWaitMaxMinutes: settings.estimatedWaitMinutes,
    waitAcknowledgmentThresholdMinutes: null,
    requiresWaitAcknowledgment: false,
    lastTableOrderAt: null,
    limits: {
      maxItemQuantity: settings.maxItemQuantity,
      maxUniqueProducts: settings.maxUniqueProducts,
      maxTotalQuantity: settings.maxTotalQuantity,
      maxNoteLength: settings.maxNoteLength,
    },
  };
}
