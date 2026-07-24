import { z } from "zod";
import { supportedProductLocales } from "./catalog-validation";
import { singleLineText } from "./input-validation";

const uuid = z.string().uuid();
const name = singleLineText({ minimum: 1, maximum: 80 });
const sortOrder = z.number().int().min(0).max(10_000);
const translations = z.array(z.object({
  locale: z.enum(supportedProductLocales),
  name: singleLineText({ minimum: 1, maximum: 120 }),
}).strict()).max(supportedProductLocales.length).refine(
  (items) => new Set(items.map((item) => item.locale)).size === items.length,
  { message: "翻譯語系不可重複。" },
).default([]);
const productIds = z.array(uuid).max(100).refine(
  (ids) => new Set(ids).size === ids.length,
  { message: "商品不可重複指派。" },
);

const groupFields = {
  name,
  selectionMode: z.enum(["SINGLE", "MULTIPLE"]),
  isRequired: z.boolean(),
  minSelections: z.number().int().min(0).max(20),
  maxSelections: z.number().int().min(1).max(20).nullable(),
  sortOrder,
  isActive: z.boolean(),
  productIds,
  translations,
} as const;

const createGroup = z.object({
  operation: z.literal("CREATE_NOTE_GROUP"),
  ...groupFields,
}).strict();
const updateGroup = z.object({
  operation: z.literal("UPDATE_NOTE_GROUP"),
  noteGroupId: uuid,
  ...groupFields,
}).strict();
const optionFields = {
  name,
  priceDelta: z.number().int().min(-10_000_000).max(10_000_000),
  sortOrder,
  isActive: z.boolean(),
  translations,
} as const;

export const productNoteCommandSchema = z.discriminatedUnion("operation", [
  createGroup,
  updateGroup,
  z.object({ operation: z.literal("DELETE_NOTE_GROUP"), noteGroupId: uuid }).strict(),
  z.object({
    operation: z.literal("CREATE_NOTE_OPTION"),
    noteGroupId: uuid,
    ...optionFields,
  }).strict(),
  z.object({
    operation: z.literal("UPDATE_NOTE_OPTION"),
    noteOptionId: uuid,
    ...optionFields,
  }).strict(),
  z.object({ operation: z.literal("DELETE_NOTE_OPTION"), noteOptionId: uuid }).strict(),
]).superRefine((command, context) => {
  if (command.operation !== "CREATE_NOTE_GROUP" && command.operation !== "UPDATE_NOTE_GROUP") return;
  if (command.selectionMode === "SINGLE" && command.maxSelections !== 1) {
    context.addIssue({ code: "custom", path: ["maxSelections"], message: "單選群組上限必須為 1。" });
  }
  if (command.isRequired && command.minSelections < 1) {
    context.addIssue({ code: "custom", path: ["minSelections"], message: "必選群組的最少選取數必須至少為 1。" });
  }
  if (!command.isRequired && command.minSelections !== 0) {
    context.addIssue({ code: "custom", path: ["minSelections"], message: "選填群組的最少選取數必須為 0。" });
  }
  if (command.selectionMode === "SINGLE" && command.minSelections > 1) {
    context.addIssue({ code: "custom", path: ["minSelections"], message: "單選群組的最少選取數不可超過 1。" });
  }
  if (command.maxSelections !== null && command.minSelections > command.maxSelections) {
    context.addIssue({ code: "custom", path: ["maxSelections"], message: "最多選取數不可小於最少選取數。" });
  }
});
