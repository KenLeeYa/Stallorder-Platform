import { z } from "zod";

const uuidSchema = z.string().uuid();
const codeSchema = z.string().trim().min(2).max(40)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]{1,39}$/));
const sourceCodeSchema = z.string().trim().min(2).max(80)
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z][A-Z0-9_]{1,79}$/));
const microQuantitySchema = z.number().int().min(-9_000_000_000_000_000).max(9_000_000_000_000_000);

const createIngredientSchema = z.object({
  operation: z.literal("CREATE_INGREDIENT"),
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  baseUom: z.string().trim().transform((value) => value.toUpperCase())
    .pipe(z.enum(["G", "KG", "ML", "L", "EA"])),
  itemType: z.enum(["INGREDIENT", "PACKAGING", "CONSUMABLE", "REUSABLE_EQUIPMENT"]).default("INGREDIENT"),
  trackExpiry: z.boolean().default(false),
  defaultShelfLifeDays: z.number().int().min(1).max(3650).nullable().optional(),
  preferredSupplierId: uuidSchema.nullable().optional(),
  lowStockThresholdMicros: z.number().int().min(0).max(9_000_000_000_000_000).default(0),
}).strict();

const updateIngredientSchema = z.object({
  operation: z.literal("UPDATE_INGREDIENT"),
  ingredientId: uuidSchema,
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  baseUom: z.string().trim().transform((value) => value.toUpperCase())
    .pipe(z.enum(["G", "KG", "ML", "L", "EA"])),
  itemType: z.enum(["INGREDIENT", "PACKAGING", "CONSUMABLE", "REUSABLE_EQUIPMENT"]),
  trackExpiry: z.boolean(),
  defaultShelfLifeDays: z.number().int().min(1).max(3650).nullable().optional(),
  preferredSupplierId: uuidSchema.nullable().optional(),
  lowStockThresholdMicros: z.number().int().min(0).max(9_000_000_000_000_000),
}).strict();

const archiveIngredientSchema = z.object({
  operation: z.literal("ARCHIVE_INGREDIENT"),
  ingredientId: uuidSchema,
}).strict();

const createSupplierSchema = z.object({
  operation: z.literal("CREATE_SUPPLIER"),
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  contactName: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365).default(0),
  leadTimeDays: z.number().int().min(0).max(365).default(0),
}).strict();

const updateSupplierSchema = z.object({
  operation: z.literal("UPDATE_SUPPLIER"),
  supplierId: uuidSchema,
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  contactName: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  paymentTermsDays: z.number().int().min(0).max(365),
  leadTimeDays: z.number().int().min(0).max(365),
}).strict();

const archiveSupplierSchema = z.object({
  operation: z.literal("ARCHIVE_SUPPLIER"),
  supplierId: uuidSchema,
}).strict();

const createLocationSchema = z.object({
  operation: z.literal("CREATE_LOCATION"),
  stallId: uuidSchema.nullable().optional(),
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  locationType: z.enum(["CENTRAL", "STALL", "STORAGE", "IN_TRANSIT"]),
}).strict();

const movementSchema = z.object({
  operation: z.literal("POST_MOVEMENT"),
  ingredientId: uuidSchema,
  locationId: uuidSchema,
  movementType: z.enum([
    "RECEIPT",
    "ADJUSTMENT",
    "WASTE",
    "TRANSFER_IN",
    "TRANSFER_OUT",
    "SALE_CONSUMPTION",
    "REVERSAL",
  ]),
  quantityDeltaMicros: microQuantitySchema.refine((value) => value !== 0, "異動數量不能為 0"),
  unitCostMicros: z.number().int().min(0).max(9_000_000_000_000_000).nullable().optional(),
  sourceType: sourceCodeSchema,
  sourceId: z.string().trim().min(1).max(160),
  idempotencyKey: z.string().trim().min(16).max(160).regex(/^[A-Za-z0-9:_-]+$/),
  reason: z.string().trim().min(1).max(300),
}).strict().superRefine((value, context) => {
  const positive = value.movementType === "RECEIPT" || value.movementType === "TRANSFER_IN";
  const negative = ["WASTE", "TRANSFER_OUT", "SALE_CONSUMPTION"].includes(value.movementType);
  if (positive && value.quantityDeltaMicros < 0) {
    context.addIssue({ code: "custom", path: ["quantityDeltaMicros"], message: "此異動類型必須增加庫存" });
  }
  if (negative && value.quantityDeltaMicros > 0) {
    context.addIssue({ code: "custom", path: ["quantityDeltaMicros"], message: "此異動類型必須扣除庫存" });
  }
});

const recipeComponentSchema = z.object({
  operation: z.literal("UPSERT_RECIPE_COMPONENT"),
  productId: uuidSchema,
  ingredientId: uuidSchema,
  quantityMicros: z.number().int().min(1).max(9_000_000_000_000_000),
  wasteBasisPoints: z.number().int().min(0).max(10_000).default(0),
}).strict();

const removeRecipeComponentSchema = z.object({
  operation: z.literal("REMOVE_RECIPE_COMPONENT"),
  componentId: uuidSchema,
}).strict();

const updateLocationSchema = z.object({
  operation: z.literal("UPDATE_LOCATION"),
  locationId: uuidSchema,
  stallId: uuidSchema.nullable().optional(),
  code: codeSchema,
  name: z.string().trim().min(1).max(120),
  locationType: z.enum(["CENTRAL", "STALL", "STORAGE", "IN_TRANSIT"]),
}).strict();

const archiveLocationSchema = z.object({
  operation: z.literal("ARCHIVE_LOCATION"),
  locationId: uuidSchema,
}).strict();

const purchaseLineSchema = z.object({
  ingredientId: uuidSchema,
  locationId: uuidSchema,
  quantityMicros: z.number().int().min(1).max(9_000_000_000_000_000),
  unitCostMicros: z.number().int().min(0).max(9_000_000_000_000_000),
  lotNumber: z.string().trim().min(1).max(100).nullable().optional(),
  manufacturedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
}).strict().refine(
  (value) => !value.manufacturedOn || !value.expiresOn || value.expiresOn >= value.manufacturedOn,
  { path: ["expiresOn"], message: "效期不得早於製造日" },
);

const receivePurchaseSchema = z.object({
  operation: z.literal("RECEIVE_PURCHASE"),
  supplierId: uuidSchema,
  stallId: uuidSchema.nullable().optional(),
  documentNumber: z.string().trim().min(1).max(80),
  orderedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  expectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
  taxAmount: z.number().int().min(0).max(1_000_000_000).default(0),
  freightAmount: z.number().int().min(0).max(1_000_000_000).default(0),
  note: z.string().trim().max(500).nullable().optional(),
  lines: z.array(purchaseLineSchema).min(1).max(100),
}).strict();

export const supplyCommandSchema = z.discriminatedUnion("operation", [
  createIngredientSchema,
  updateIngredientSchema,
  archiveIngredientSchema,
  createSupplierSchema,
  updateSupplierSchema,
  archiveSupplierSchema,
  createLocationSchema,
  updateLocationSchema,
  archiveLocationSchema,
  movementSchema,
  recipeComponentSchema,
  removeRecipeComponentSchema,
  receivePurchaseSchema,
]);

export type SupplyCommand = z.infer<typeof supplyCommandSchema>;
