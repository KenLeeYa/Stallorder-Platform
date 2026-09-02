import TraditionalDict from "@pinyin-pro/data/traditional";
import { pinyin } from "pinyin-pro";

export type SupplyItemType = "INGREDIENT" | "PACKAGING" | "CONSUMABLE" | "REUSABLE_EQUIPMENT";

const CODE_MAX_LENGTH = 40;
const itemTypePrefixes: Record<SupplyItemType, string> = {
  INGREDIENT: "ING",
  PACKAGING: "PKG",
  CONSUMABLE: "CON",
  REUSABLE_EQUIPMENT: "EQP",
};

const traditionalOverrides: Record<string, string> = {
  車: "车",
};

export function suggestSupplyItemCode(input: {
  name: string;
  itemType: SupplyItemType;
  existingCodes: readonly string[];
  currentCode?: string;
}) {
  const prefix = itemTypePrefixes[input.itemType];
  const normalizedName = input.name.normalize("NFKC").trim();
  const simplifiedName = Array.from(normalizedName, (character) => (
    traditionalOverrides[character]
    ?? TraditionalDict[character as keyof typeof TraditionalDict]
    ?? character
  )).join("");
  const romanized = pinyin(simplifiedName, {
    toneType: "none",
    nonZh: "consecutive",
    v: true,
  });
  const nameCode = romanized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    || "ITEM";
  const baseCode = `${prefix}-${nameCode}`.slice(0, CODE_MAX_LENGTH).replace(/[-_]+$/g, "");
  const currentCode = input.currentCode?.trim().toUpperCase();
  const unavailableCodes = new Set(
    input.existingCodes
      .map((code) => code.trim().toUpperCase())
      .filter((code) => code && code !== currentCode),
  );

  if (!unavailableCodes.has(baseCode)) return baseCode;
  for (let index = 2; index < 10_000; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${baseCode.slice(0, CODE_MAX_LENGTH - suffix.length).replace(/[-_]+$/g, "")}${suffix}`;
    if (!unavailableCodes.has(candidate)) return candidate;
  }
  return `${prefix}-ITEM`;
}
