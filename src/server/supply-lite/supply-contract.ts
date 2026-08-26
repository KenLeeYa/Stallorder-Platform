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
  lowStockThresholdMicros: z.number().int().min(0).max(9_000_000_000_000_000).default(0),
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

export const supplyCommandSchema = z.discriminatedUnion("operation", [
  createIngredientSchema,
  createLocationSchema,
  movementSchema,
  recipeComponentSchema,
]);

export type SupplyCommand = z.infer<typeof supplyCommandSchema>;
