import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import type { SupplyCommand } from "@/server/supply-lite/supply-contract";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export class SupplyOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SupplyOperationError";
  }
}

async function assertSupplyModuleEnabled(organizationId: string) {
  const flags = await resolveResilienceFeatureFlags(
    ["MODULE_SUPPLY_LITE_ENABLED"],
    { organizationId, rolloutKey: organizationId },
  );
  if (!flags.MODULE_SUPPLY_LITE_ENABLED.enabled) {
    throw new SupplyOperationError("SUPPLY_MODULE_DISABLED");
  }
}

export async function getSupplyDashboard(organizationId: string) {
  await assertSupplyModuleEnabled(organizationId);
  const [ingredients, locations, balances, products, stalls, recipeComponents, recentMovements] = await Promise.all([
    prisma.supplyIngredient.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 500,
    }),
    prisma.supplyLocation.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ locationType: "asc" }, { name: "asc" }, { id: "asc" }],
      take: 200,
    }),
    prisma.supplyInventoryBalance.findMany({
      where: { organizationId },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 2_000,
    }),
    prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true, kind: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      take: 1_000,
    }),
    prisma.stall.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 500,
    }),
    prisma.supplyRecipeComponent.findMany({
      where: { organizationId },
      orderBy: [{ productId: "asc" }, { ingredientId: "asc" }],
      take: 5_000,
    }),
    prisma.supplyInventoryMovement.findMany({
      where: { organizationId },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
  ]);

  const quantityByIngredient = new Map<string, bigint>();
  for (const balance of balances) {
    quantityByIngredient.set(
      balance.ingredientId,
      (quantityByIngredient.get(balance.ingredientId) ?? BigInt(0)) + balance.quantityMicros,
    );
  }

  return {
    ingredients: ingredients.map((ingredient) => ({
      id: ingredient.id,
      code: ingredient.code,
      name: ingredient.name,
      baseUom: ingredient.baseUom,
      lowStockThresholdMicros: ingredient.lowStockThresholdMicros.toString(),
      totalQuantityMicros: (quantityByIngredient.get(ingredient.id) ?? BigInt(0)).toString(),
      lowStock: (quantityByIngredient.get(ingredient.id) ?? BigInt(0)) <= ingredient.lowStockThresholdMicros,
    })),
    locations: locations.map((location) => ({
      id: location.id,
      stallId: location.stallId,
      code: location.code,
      name: location.name,
      locationType: location.locationType,
    })),
    balances: balances.map((balance) => ({
      id: balance.id,
      ingredientId: balance.ingredientId,
      locationId: balance.locationId,
      quantityMicros: balance.quantityMicros.toString(),
      averageUnitCostMicros: balance.averageUnitCostMicros.toString(),
      updatedAt: balance.updatedAt.toISOString(),
    })),
    products,
    stalls,
    recipeComponents: recipeComponents.map((component) => ({
      id: component.id,
      productId: component.productId,
      ingredientId: component.ingredientId,
      quantityMicros: component.quantityMicros.toString(),
      wasteBasisPoints: component.wasteBasisPoints,
    })),
    recentMovements: recentMovements.map((movement) => ({
      id: movement.id,
      ingredientId: movement.ingredientId,
      locationId: movement.locationId,
      movementType: movement.movementType,
      quantityDeltaMicros: movement.quantityDeltaMicros.toString(),
      sourceType: movement.sourceType,
      sourceId: movement.sourceId,
      reason: movement.reason,
      createdAt: movement.createdAt.toISOString(),
    })),
  };
}

export async function applySupplyCommand(input: {
  organizationId: string;
  actorProfileId: string;
  command: SupplyCommand;
}) {
  await assertSupplyModuleEnabled(input.organizationId);
  try {
    switch (input.command.operation) {
      case "CREATE_INGREDIENT":
        return await prisma.supplyIngredient.create({
          data: {
            organizationId: input.organizationId,
            code: input.command.code,
            name: input.command.name,
            baseUom: input.command.baseUom,
            lowStockThresholdMicros: BigInt(input.command.lowStockThresholdMicros),
            createdByProfileId: input.actorProfileId,
          },
        });
      case "CREATE_LOCATION":
        return await createLocation({ ...input, command: input.command });
      case "UPSERT_RECIPE_COMPONENT":
        return await upsertRecipeComponent({ ...input, command: input.command });
      case "POST_MOVEMENT":
        return await postMovement({ ...input, command: input.command });
    }
  } catch (error) {
    if (error instanceof SupplyOperationError) throw error;
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new SupplyOperationError("SUPPLY_DUPLICATE_RECORD");
    }
    throw error;
  }
}

async function createLocation(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<SupplyCommand, { operation: "CREATE_LOCATION" }>;
}) {
  if (input.command.locationType === "STALL") {
    const stall = await prisma.stall.findFirst({
      where: { id: input.command.stallId ?? "", organizationId: input.organizationId, isActive: true },
      select: { id: true },
    });
    if (!stall) throw new SupplyOperationError("SUPPLY_STALL_NOT_FOUND");
  } else if (input.command.stallId) {
    throw new SupplyOperationError("SUPPLY_LOCATION_SCOPE_INVALID");
  }
  return prisma.supplyLocation.create({
    data: {
      organizationId: input.organizationId,
      stallId: input.command.stallId ?? null,
      code: input.command.code,
      name: input.command.name,
      locationType: input.command.locationType,
      createdByProfileId: input.actorProfileId,
    },
  });
}

async function upsertRecipeComponent(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<SupplyCommand, { operation: "UPSERT_RECIPE_COMPONENT" }>;
}) {
  return prisma.$transaction(async (transaction) => {
    const [product, ingredient] = await Promise.all([
      transaction.product.findFirst({
        where: { id: input.command.productId, organizationId: input.organizationId, isActive: true },
        select: { id: true },
      }),
      transaction.supplyIngredient.findFirst({
        where: { id: input.command.ingredientId, organizationId: input.organizationId, isActive: true },
        select: { id: true },
      }),
    ]);
    if (!product) throw new SupplyOperationError("SUPPLY_PRODUCT_NOT_FOUND");
    if (!ingredient) throw new SupplyOperationError("SUPPLY_INGREDIENT_NOT_FOUND");
    return transaction.supplyRecipeComponent.upsert({
      where: {
        organizationId_productId_ingredientId: {
          organizationId: input.organizationId,
          productId: product.id,
          ingredientId: ingredient.id,
        },
      },
      create: {
        organizationId: input.organizationId,
        productId: product.id,
        ingredientId: ingredient.id,
        quantityMicros: BigInt(input.command.quantityMicros),
        wasteBasisPoints: input.command.wasteBasisPoints,
        createdByProfileId: input.actorProfileId,
      },
      update: {
        quantityMicros: BigInt(input.command.quantityMicros),
        wasteBasisPoints: input.command.wasteBasisPoints,
      },
    });
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function postMovement(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<SupplyCommand, { operation: "POST_MOVEMENT" }>;
}) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(
        ${`supply:${input.organizationId}:${input.command.locationId}:${input.command.ingredientId}`}::text,
        0
      ))
    `);

    const existing = await transaction.supplyInventoryMovement.findUnique({
      where: {
        organizationId_idempotencyKey: {
          organizationId: input.organizationId,
          idempotencyKey: input.command.idempotencyKey,
        },
      },
    });
    if (existing) {
      if (!movementPayloadMatches(existing, input.command)) {
        throw new SupplyOperationError("SUPPLY_IDEMPOTENCY_CONFLICT");
      }
      return existing;
    }

    const [ingredient, location] = await Promise.all([
      transaction.supplyIngredient.findFirst({
        where: { id: input.command.ingredientId, organizationId: input.organizationId, isActive: true },
        select: { id: true },
      }),
      transaction.supplyLocation.findFirst({
        where: { id: input.command.locationId, organizationId: input.organizationId, isActive: true },
        select: { id: true },
      }),
    ]);
    if (!ingredient) throw new SupplyOperationError("SUPPLY_INGREDIENT_NOT_FOUND");
    if (!location) throw new SupplyOperationError("SUPPLY_LOCATION_NOT_FOUND");

    const quantityDelta = BigInt(input.command.quantityDeltaMicros);
    const unitCost = input.command.unitCostMicros == null ? null : BigInt(input.command.unitCostMicros);
    const movement = await transaction.supplyInventoryMovement.create({
      data: {
        organizationId: input.organizationId,
        ingredientId: ingredient.id,
        locationId: location.id,
        movementType: input.command.movementType,
        quantityDeltaMicros: quantityDelta,
        unitCostMicros: unitCost,
        sourceType: input.command.sourceType,
        sourceId: input.command.sourceId,
        idempotencyKey: input.command.idempotencyKey,
        reason: input.command.reason,
        actorProfileId: input.actorProfileId,
      },
    });
    const current = await transaction.supplyInventoryBalance.findUnique({
      where: {
        organizationId_ingredientId_locationId: {
          organizationId: input.organizationId,
          ingredientId: ingredient.id,
          locationId: location.id,
        },
      },
    });
    const quantity = (current?.quantityMicros ?? BigInt(0)) + quantityDelta;
    const averageUnitCost = calculateAverageUnitCost({
      previousQuantity: current?.quantityMicros ?? BigInt(0),
      previousAverageUnitCost: current?.averageUnitCostMicros ?? BigInt(0),
      incomingQuantity: quantityDelta,
      incomingUnitCost: unitCost,
    });
    await transaction.supplyInventoryBalance.upsert({
      where: {
        organizationId_ingredientId_locationId: {
          organizationId: input.organizationId,
          ingredientId: ingredient.id,
          locationId: location.id,
        },
      },
      create: {
        organizationId: input.organizationId,
        ingredientId: ingredient.id,
        locationId: location.id,
        quantityMicros: quantity,
        averageUnitCostMicros: averageUnitCost,
        lastMovementId: movement.id,
      },
      update: {
        quantityMicros: quantity,
        averageUnitCostMicros: averageUnitCost,
        lastMovementId: movement.id,
      },
    });
    return movement;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function movementPayloadMatches(
  existing: {
    ingredientId: string;
    locationId: string;
    movementType: string;
    quantityDeltaMicros: bigint;
    unitCostMicros: bigint | null;
    sourceType: string;
    sourceId: string;
    reason: string;
  },
  command: Extract<SupplyCommand, { operation: "POST_MOVEMENT" }>,
) {
  return existing.ingredientId === command.ingredientId
    && existing.locationId === command.locationId
    && existing.movementType === command.movementType
    && existing.quantityDeltaMicros === BigInt(command.quantityDeltaMicros)
    && existing.unitCostMicros === (command.unitCostMicros == null ? null : BigInt(command.unitCostMicros))
    && existing.sourceType === command.sourceType
    && existing.sourceId === command.sourceId
    && existing.reason === command.reason;
}

export function calculateAverageUnitCost(input: {
  previousQuantity: bigint;
  previousAverageUnitCost: bigint;
  incomingQuantity: bigint;
  incomingUnitCost: bigint | null;
}) {
  if (input.incomingQuantity <= BigInt(0) || input.incomingUnitCost == null) {
    return input.previousAverageUnitCost;
  }
  const previousQuantity = input.previousQuantity > BigInt(0) ? input.previousQuantity : BigInt(0);
  const combinedQuantity = previousQuantity + input.incomingQuantity;
  if (combinedQuantity === BigInt(0)) return input.incomingUnitCost;
  return (
    previousQuantity * input.previousAverageUnitCost
    + input.incomingQuantity * input.incomingUnitCost
  ) / combinedQuantity;
}
