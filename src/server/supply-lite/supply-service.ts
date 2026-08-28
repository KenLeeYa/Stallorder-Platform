import "server-only";

import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/prisma";
import { calendarDateInTimeZone } from "@/lib/date-time";
import type { SupplyCommand } from "@/server/supply-lite/supply-contract";
import { resolveResilienceFeatureFlags } from "@/server/resilience/feature-flag-service";

export class SupplyOperationError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "SupplyOperationError";
  }
}

export type SupplyAccessScope = {
  canUseAllStalls: boolean;
  authorizedStallIds: readonly string[];
};

async function assertSupplyModuleEnabled(organizationId: string) {
  const flags = await resolveResilienceFeatureFlags(
    ["MODULE_SUPPLY_LITE_ENABLED"],
    { organizationId, rolloutKey: organizationId },
  );
  if (!flags.MODULE_SUPPLY_LITE_ENABLED.enabled) {
    throw new SupplyOperationError("SUPPLY_MODULE_DISABLED");
  }
}

export async function getSupplyDashboard(input: {
  organizationId: string;
  accessScope: SupplyAccessScope;
}) {
  const { organizationId } = input;
  await assertSupplyModuleEnabled(organizationId);
  const restrictedStallIds = input.accessScope.canUseAllStalls
    ? null
    : [...new Set(input.accessScope.authorizedStallIds)];
  const locations = await prisma.supplyLocation.findMany({
    where: {
      organizationId,
      isActive: true,
      ...(restrictedStallIds ? { stallId: { in: restrictedStallIds } } : {}),
    },
    orderBy: [{ locationType: "asc" }, { name: "asc" }, { id: "asc" }],
    take: 200,
  });
  const locationIds = locations.map((location) => location.id);
  const locationScopeWhere = restrictedStallIds ? { locationId: { in: locationIds } } : {};
  const [
    ingredients,
    balances,
    products,
    stalls,
    recipeComponents,
    recentMovements,
    suppliers,
    purchaseOrders,
    inventoryLots,
  ] = await Promise.all([
    prisma.supplyIngredient.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 500,
    }),
    prisma.supplyInventoryBalance.findMany({
      where: { organizationId, ...locationScopeWhere },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 2_000,
    }),
    prisma.product.findMany({
      where: { organizationId, isActive: true },
      select: { id: true, name: true, kind: true, defaultPrice: true },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      take: 1_000,
    }),
    prisma.stall.findMany({
      where: {
        organizationId,
        isActive: true,
        ...(restrictedStallIds ? { id: { in: restrictedStallIds } } : {}),
      },
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
      where: { organizationId, ...locationScopeWhere },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 50,
    }),
    prisma.supplySupplier.findMany({
      where: { organizationId, isActive: true },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: 500,
    }),
    prisma.supplyPurchaseOrder.findMany({
      where: {
        organizationId,
        ...(restrictedStallIds ? { stallId: { in: restrictedStallIds } } : {}),
      },
      orderBy: [{ orderedOn: "desc" }, { createdAt: "desc" }],
      take: 50,
    }),
    prisma.supplyInventoryLot.findMany({
      where: {
        organizationId,
        remainingQuantityMicros: { gt: BigInt(0) },
        ...locationScopeWhere,
      },
      orderBy: [{ expiresOn: "asc" }, { receivedAt: "asc" }],
      take: 1_000,
    }),
  ]);
  const purchaseOrderLines = await prisma.supplyPurchaseOrderLine.findMany({
    where: {
      organizationId,
      ...(restrictedStallIds ? { purchaseOrderId: { in: purchaseOrders.map((order) => order.id) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 500,
  });

  const quantityByIngredient = new Map<string, bigint>();
  for (const balance of balances) {
    quantityByIngredient.set(
      balance.ingredientId,
      (quantityByIngredient.get(balance.ingredientId) ?? BigInt(0)) + balance.quantityMicros,
    );
  }
  const costValueByIngredient = new Map<string, bigint>();
  const costQuantityByIngredient = new Map<string, bigint>();
  for (const balance of balances) {
    if (balance.quantityMicros <= BigInt(0)) continue;
    costValueByIngredient.set(
      balance.ingredientId,
      (costValueByIngredient.get(balance.ingredientId) ?? BigInt(0))
        + balance.quantityMicros * balance.averageUnitCostMicros,
    );
    costQuantityByIngredient.set(
      balance.ingredientId,
      (costQuantityByIngredient.get(balance.ingredientId) ?? BigInt(0)) + balance.quantityMicros,
    );
  }
  const averageCostByIngredient = new Map<string, bigint>();
  for (const ingredient of ingredients) {
    const quantity = costQuantityByIngredient.get(ingredient.id) ?? BigInt(0);
    averageCostByIngredient.set(
      ingredient.id,
      quantity > BigInt(0) ? (costValueByIngredient.get(ingredient.id) ?? BigInt(0)) / quantity : BigInt(0),
    );
  }
  const productCostMicros = new Map<string, bigint>();
  for (const component of recipeComponents) {
    const unitCost = averageCostByIngredient.get(component.ingredientId) ?? BigInt(0);
    const baseCost = component.quantityMicros * unitCost / BigInt(1_000_000);
    const costWithWaste = baseCost * BigInt(10_000 + component.wasteBasisPoints) / BigInt(10_000);
    productCostMicros.set(
      component.productId,
      (productCostMicros.get(component.productId) ?? BigInt(0)) + costWithWaste,
    );
  }
  const supplierNames = new Map(suppliers.map((supplier) => [supplier.id, supplier.name]));
  const purchaseLineCount = new Map<string, number>();
  for (const line of purchaseOrderLines) {
    purchaseLineCount.set(line.purchaseOrderId, (purchaseLineCount.get(line.purchaseOrderId) ?? 0) + 1);
  }
  const trackedIngredientIds = new Set(
    ingredients.filter((ingredient) => ingredient.trackExpiry).map((ingredient) => ingredient.id),
  );
  const balanceByIngredientLocation = new Map<string, bigint>();
  const lotByIngredientLocation = new Map<string, bigint>();
  for (const balance of balances) {
    if (!trackedIngredientIds.has(balance.ingredientId)) continue;
    balanceByIngredientLocation.set(
      `${balance.ingredientId}:${balance.locationId}`,
      balance.quantityMicros > BigInt(0) ? balance.quantityMicros : BigInt(0),
    );
  }
  for (const lot of inventoryLots) {
    if (!trackedIngredientIds.has(lot.ingredientId)) continue;
    const key = `${lot.ingredientId}:${lot.locationId}`;
    lotByIngredientLocation.set(key, (lotByIngredientLocation.get(key) ?? BigInt(0)) + lot.remainingQuantityMicros);
  }
  const lotCoverageKeys = new Set([...balanceByIngredientLocation.keys(), ...lotByIngredientLocation.keys()]);
  const lotCoverageGapCount = [...lotCoverageKeys].filter((key) =>
    (balanceByIngredientLocation.get(key) ?? BigInt(0)) !== (lotByIngredientLocation.get(key) ?? BigInt(0))
  ).length;

  return {
    asOfDate: calendarDateInTimeZone(new Date(), "Asia/Taipei"),
    ingredients: ingredients.map((ingredient) => ({
      id: ingredient.id,
      code: ingredient.code,
      name: ingredient.name,
      baseUom: ingredient.baseUom,
      itemType: ingredient.itemType,
      trackExpiry: ingredient.trackExpiry,
      defaultShelfLifeDays: ingredient.defaultShelfLifeDays,
      preferredSupplierId: ingredient.preferredSupplierId,
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
    suppliers: suppliers.map((supplier) => ({
      id: supplier.id,
      code: supplier.code,
      name: supplier.name,
      contactName: supplier.contactName,
      phone: supplier.phone,
      email: supplier.email,
      paymentTermsDays: supplier.paymentTermsDays,
      leadTimeDays: supplier.leadTimeDays,
    })),
    purchaseOrders: purchaseOrders.map((order) => ({
      id: order.id,
      supplierId: order.supplierId,
      supplierName: supplierNames.get(order.supplierId) ?? "未知廠商",
      documentNumber: order.documentNumber,
      orderedOn: order.orderedOn.toISOString().slice(0, 10),
      status: order.status,
      totalAmount: order.totalAmount,
      lineCount: purchaseLineCount.get(order.id) ?? 0,
      receivedAt: order.receivedAt?.toISOString() ?? null,
    })),
    inventoryLots: inventoryLots.map((lot) => ({
      id: lot.id,
      ingredientId: lot.ingredientId,
      locationId: lot.locationId,
      lotNumber: lot.lotNumber,
      remainingQuantityMicros: lot.remainingQuantityMicros.toString(),
      expiresOn: lot.expiresOn?.toISOString().slice(0, 10) ?? null,
      status: lot.status,
    })),
    productCosts: products.map((product) => {
      const costMicros = productCostMicros.get(product.id) ?? BigInt(0);
      const costAmount = Number((costMicros + BigInt(500_000)) / BigInt(1_000_000));
      const grossProfit = product.defaultPrice - costAmount;
      return {
        productId: product.id,
        productName: product.name,
        sellingPrice: product.defaultPrice,
        recipeCostMicros: costMicros.toString(),
        recipeCostAmount: costAmount,
        grossProfit,
        grossMarginBasisPoints: product.defaultPrice > 0
          ? Math.round(grossProfit * 10_000 / product.defaultPrice)
          : 0,
        recipeComplete: recipeComponents.some((component) => component.productId === product.id),
      };
    }),
    inventoryValueAmount: Number(
      balances.reduce((sum, balance) => balance.quantityMicros > BigInt(0)
        ? sum + balance.quantityMicros * balance.averageUnitCostMicros
        : sum, BigInt(0)) / BigInt(1_000_000_000_000),
    ),
    lotCoverageGapCount,
  };
}

export async function applySupplyCommand(input: {
  organizationId: string;
  actorProfileId: string;
  command: SupplyCommand;
  accessScope: SupplyAccessScope;
}) {
  await assertSupplyModuleEnabled(input.organizationId);
  try {
    switch (input.command.operation) {
      case "CREATE_INGREDIENT":
        if (input.command.preferredSupplierId) {
          const supplier = await prisma.supplySupplier.findFirst({
            where: { id: input.command.preferredSupplierId, organizationId: input.organizationId, isActive: true },
            select: { id: true },
          });
          if (!supplier) throw new SupplyOperationError("SUPPLY_SUPPLIER_NOT_FOUND");
        }
        return await prisma.supplyIngredient.create({
          data: {
            organizationId: input.organizationId,
            code: input.command.code,
            name: input.command.name,
            baseUom: input.command.baseUom,
            itemType: input.command.itemType,
            trackExpiry: input.command.trackExpiry,
            defaultShelfLifeDays: input.command.defaultShelfLifeDays ?? null,
            preferredSupplierId: input.command.preferredSupplierId ?? null,
            lowStockThresholdMicros: BigInt(input.command.lowStockThresholdMicros),
            createdByProfileId: input.actorProfileId,
          },
        });
      case "CREATE_SUPPLIER":
        return await prisma.supplySupplier.create({
          data: {
            organizationId: input.organizationId,
            code: input.command.code,
            name: input.command.name,
            contactName: input.command.contactName ?? null,
            phone: input.command.phone ?? null,
            email: input.command.email ?? null,
            paymentTermsDays: input.command.paymentTermsDays,
            leadTimeDays: input.command.leadTimeDays,
            createdByProfileId: input.actorProfileId,
          },
        });
      case "CREATE_LOCATION":
        return await createLocation({ ...input, command: input.command });
      case "UPSERT_RECIPE_COMPONENT":
        return await upsertRecipeComponent({ ...input, command: input.command });
      case "POST_MOVEMENT":
        return await postMovement({ ...input, command: input.command });
      case "RECEIVE_PURCHASE":
        return await receivePurchase({ ...input, command: input.command });
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
  accessScope: SupplyAccessScope;
}) {
  if (!input.accessScope.canUseAllStalls) {
    if (input.command.locationType !== "STALL" || !isAuthorizedStall(input.accessScope, input.command.stallId)) {
      throw new SupplyOperationError("SUPPLY_SCOPE_DENIED");
    }
  }
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
  accessScope: SupplyAccessScope;
}) {
  return prisma.$transaction(async (transaction) => {
    await transaction.$executeRaw(Prisma.sql`
      select pg_advisory_xact_lock(hashtextextended(
        ${`supply:${input.organizationId}:${input.command.locationId}:${input.command.ingredientId}`}::text,
        0
      ))
    `);

    const location = await transaction.supplyLocation.findFirst({
      where: { id: input.command.locationId, organizationId: input.organizationId, isActive: true },
      select: { id: true, stallId: true },
    });
    if (!location) throw new SupplyOperationError("SUPPLY_LOCATION_NOT_FOUND");
    assertLocationAccess(input.accessScope, location.stallId);

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

    const ingredient = await transaction.supplyIngredient.findFirst({
      where: { id: input.command.ingredientId, organizationId: input.organizationId, isActive: true },
      select: { id: true, trackExpiry: true },
    });
    if (!ingredient) throw new SupplyOperationError("SUPPLY_INGREDIENT_NOT_FOUND");
    if (ingredient.trackExpiry && input.command.movementType === "RECEIPT") {
      throw new SupplyOperationError("SUPPLY_LOT_REQUIRED");
    }

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
    if (ingredient.trackExpiry && quantityDelta < BigInt(0)) {
      const lots = await transaction.supplyInventoryLot.findMany({
        where: {
          organizationId: input.organizationId,
          ingredientId: ingredient.id,
          locationId: location.id,
          remainingQuantityMicros: { gt: BigInt(0) },
          status: { in: input.command.movementType === "WASTE" ? ["AVAILABLE", "QUARANTINED"] : ["AVAILABLE"] },
        },
        select: {
          id: true,
          remainingQuantityMicros: true,
          expiresOn: true,
          receivedAt: true,
        },
      });
      const allocation = allocateFefoLotConsumption(lots, -quantityDelta);
      for (const lot of allocation.allocations) {
        await transaction.supplyInventoryLot.update({
          where: { id: lot.id },
          data: {
            remainingQuantityMicros: lot.remaining,
            ...(lot.remaining === BigInt(0) ? { status: "CONSUMED" } : {}),
          },
        });
      }
    }
    return movement;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function receivePurchase(input: {
  organizationId: string;
  actorProfileId: string;
  command: Extract<SupplyCommand, { operation: "RECEIVE_PURCHASE" }>;
  accessScope: SupplyAccessScope;
}) {
  if (!input.accessScope.canUseAllStalls && !isAuthorizedStall(input.accessScope, input.command.stallId)) {
    throw new SupplyOperationError("SUPPLY_SCOPE_DENIED");
  }
  return prisma.$transaction(async (transaction) => {
    const [supplier, stall, ingredients, locations] = await Promise.all([
      transaction.supplySupplier.findFirst({
        where: { id: input.command.supplierId, organizationId: input.organizationId, isActive: true },
        select: { id: true },
      }),
      input.command.stallId ? transaction.stall.findFirst({
        where: { id: input.command.stallId, organizationId: input.organizationId, isActive: true },
        select: { id: true },
      }) : Promise.resolve({ id: "organization-wide" }),
      transaction.supplyIngredient.findMany({
        where: {
          organizationId: input.organizationId,
          id: { in: [...new Set(input.command.lines.map((line) => line.ingredientId))] },
          isActive: true,
        },
        select: { id: true, trackExpiry: true },
      }),
      transaction.supplyLocation.findMany({
        where: {
          organizationId: input.organizationId,
          id: { in: [...new Set(input.command.lines.map((line) => line.locationId))] },
          isActive: true,
        },
        select: { id: true, stallId: true },
      }),
    ]);
    if (!supplier) throw new SupplyOperationError("SUPPLY_SUPPLIER_NOT_FOUND");
    if (!stall) throw new SupplyOperationError("SUPPLY_STALL_NOT_FOUND");
    if (ingredients.length !== new Set(input.command.lines.map((line) => line.ingredientId)).size) {
      throw new SupplyOperationError("SUPPLY_INGREDIENT_NOT_FOUND");
    }
    if (locations.length !== new Set(input.command.lines.map((line) => line.locationId)).size) {
      throw new SupplyOperationError("SUPPLY_LOCATION_NOT_FOUND");
    }
    for (const location of locations) assertLocationAccess(input.accessScope, location.stallId);
    const ingredientById = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));
    for (const line of input.command.lines) {
      if (ingredientById.get(line.ingredientId)?.trackExpiry && !line.lotNumber) {
        throw new SupplyOperationError("SUPPLY_LOT_REQUIRED");
      }
    }
    const lineAmounts = input.command.lines.map((line) => purchaseLineAmount(
      BigInt(line.quantityMicros),
      BigInt(line.unitCostMicros),
    ));
    const subtotalAmount = lineAmounts.reduce((sum, amount) => sum + amount, 0);
    const order = await transaction.supplyPurchaseOrder.create({
      data: {
        organizationId: input.organizationId,
        supplierId: input.command.supplierId,
        stallId: input.command.stallId ?? null,
        documentNumber: input.command.documentNumber,
        orderedOn: new Date(`${input.command.orderedOn}T00:00:00.000Z`),
        expectedOn: input.command.expectedOn ? new Date(`${input.command.expectedOn}T00:00:00.000Z`) : null,
        status: "RECEIVED",
        subtotalAmount,
        taxAmount: input.command.taxAmount,
        freightAmount: input.command.freightAmount,
        totalAmount: subtotalAmount + input.command.taxAmount + input.command.freightAmount,
        note: input.command.note ?? null,
        receivedAt: new Date(),
        createdByProfileId: input.actorProfileId,
      },
    });

    for (const [index, line] of input.command.lines.entries()) {
      await transaction.$executeRaw(Prisma.sql`
        select pg_advisory_xact_lock(hashtextextended(
          ${`supply:${input.organizationId}:${line.locationId}:${line.ingredientId}`}::text,
          0
        ))
      `);
      const purchaseLine = await transaction.supplyPurchaseOrderLine.create({
        data: {
          organizationId: input.organizationId,
          purchaseOrderId: order.id,
          ingredientId: line.ingredientId,
          locationId: line.locationId,
          quantityMicros: BigInt(line.quantityMicros),
          unitCostMicros: BigInt(line.unitCostMicros),
          lineAmount: lineAmounts[index],
          lotNumber: line.lotNumber ?? null,
          manufacturedOn: line.manufacturedOn ? new Date(`${line.manufacturedOn}T00:00:00.000Z`) : null,
          expiresOn: line.expiresOn ? new Date(`${line.expiresOn}T00:00:00.000Z`) : null,
        },
      });
      const quantityDelta = BigInt(line.quantityMicros);
      const unitCost = BigInt(line.unitCostMicros);
      const movement = await transaction.supplyInventoryMovement.create({
        data: {
          organizationId: input.organizationId,
          ingredientId: line.ingredientId,
          locationId: line.locationId,
          movementType: "RECEIPT",
          quantityDeltaMicros: quantityDelta,
          unitCostMicros: unitCost,
          sourceType: "PURCHASE_ORDER",
          sourceId: order.id,
          idempotencyKey: `supply:purchase:${order.id}:${index}`,
          reason: `進貨單 ${input.command.documentNumber}`,
          actorProfileId: input.actorProfileId,
        },
      });
      const current = await transaction.supplyInventoryBalance.findUnique({
        where: {
          organizationId_ingredientId_locationId: {
            organizationId: input.organizationId,
            ingredientId: line.ingredientId,
            locationId: line.locationId,
          },
        },
      });
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
            ingredientId: line.ingredientId,
            locationId: line.locationId,
          },
        },
        create: {
          organizationId: input.organizationId,
          ingredientId: line.ingredientId,
          locationId: line.locationId,
          quantityMicros: quantityDelta,
          averageUnitCostMicros: averageUnitCost,
          lastMovementId: movement.id,
        },
        update: {
          quantityMicros: (current?.quantityMicros ?? BigInt(0)) + quantityDelta,
          averageUnitCostMicros: averageUnitCost,
          lastMovementId: movement.id,
        },
      });
      if (line.lotNumber) {
        const existingLot = await transaction.supplyInventoryLot.findUnique({
          where: {
            organizationId_ingredientId_locationId_lotNumber: {
              organizationId: input.organizationId,
              ingredientId: line.ingredientId,
              locationId: line.locationId,
              lotNumber: line.lotNumber,
            },
          },
        });
        if (existingLot) {
          const combinedQuantity = existingLot.receivedQuantityMicros + quantityDelta;
          const combinedCost = (
            existingLot.receivedQuantityMicros * existingLot.unitCostMicros
            + quantityDelta * unitCost
          ) / combinedQuantity;
          await transaction.supplyInventoryLot.update({
            where: { id: existingLot.id },
            data: {
              receivedQuantityMicros: combinedQuantity,
              remainingQuantityMicros: existingLot.remainingQuantityMicros + quantityDelta,
              unitCostMicros: combinedCost,
              expiresOn: line.expiresOn ? new Date(`${line.expiresOn}T00:00:00.000Z`) : existingLot.expiresOn,
              status: "AVAILABLE",
            },
          });
        } else {
          await transaction.supplyInventoryLot.create({
            data: {
              organizationId: input.organizationId,
              purchaseOrderLineId: purchaseLine.id,
              ingredientId: line.ingredientId,
              locationId: line.locationId,
              lotNumber: line.lotNumber,
              receivedQuantityMicros: quantityDelta,
              remainingQuantityMicros: quantityDelta,
              unitCostMicros: unitCost,
              manufacturedOn: line.manufacturedOn ? new Date(`${line.manufacturedOn}T00:00:00.000Z`) : null,
              expiresOn: line.expiresOn ? new Date(`${line.expiresOn}T00:00:00.000Z`) : null,
            },
          });
        }
      }
    }
    return order;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

function isAuthorizedStall(scope: SupplyAccessScope, stallId: string | null | undefined) {
  return Boolean(stallId && scope.authorizedStallIds.includes(stallId));
}

function assertLocationAccess(scope: SupplyAccessScope, stallId: string | null) {
  if (!scope.canUseAllStalls && !isAuthorizedStall(scope, stallId)) {
    throw new SupplyOperationError("SUPPLY_SCOPE_DENIED");
  }
}

function purchaseLineAmount(quantityMicros: bigint, unitCostMicros: bigint) {
  const rounded = (quantityMicros * unitCostMicros + BigInt(500_000_000_000)) / BigInt(1_000_000_000_000);
  if (rounded > BigInt(1_000_000_000)) throw new SupplyOperationError("SUPPLY_PURCHASE_AMOUNT_TOO_LARGE");
  return Number(rounded);
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

export function allocateFefoLotConsumption(
  lots: Array<{
    id: string;
    remainingQuantityMicros: bigint;
    expiresOn: Date | null;
    receivedAt: Date;
  }>,
  requestedQuantityMicros: bigint,
) {
  let unallocated = requestedQuantityMicros > BigInt(0) ? requestedQuantityMicros : BigInt(0);
  const allocations: Array<{ id: string; consumed: bigint; remaining: bigint }> = [];
  const sortedLots = [...lots].sort((left, right) => {
    if (left.expiresOn && right.expiresOn) {
      const expiryDifference = left.expiresOn.getTime() - right.expiresOn.getTime();
      if (expiryDifference !== 0) return expiryDifference;
    } else if (left.expiresOn) {
      return -1;
    } else if (right.expiresOn) {
      return 1;
    }
    return left.receivedAt.getTime() - right.receivedAt.getTime();
  });
  for (const lot of sortedLots) {
    if (unallocated === BigInt(0)) break;
    const available = lot.remainingQuantityMicros > BigInt(0) ? lot.remainingQuantityMicros : BigInt(0);
    const consumed = available < unallocated ? available : unallocated;
    if (consumed === BigInt(0)) continue;
    allocations.push({
      id: lot.id,
      consumed,
      remaining: available - consumed,
    });
    unallocated -= consumed;
  }
  return { allocations, unallocated };
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
