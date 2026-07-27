import TraditionalDict from "@pinyin-pro/data/traditional";
import { pinyin } from "pinyin-pro";
import { PUBLIC_IDENTIFIER_MAX_LENGTH, PUBLIC_IDENTIFIER_MIN_LENGTH } from "@/lib/public-identifier";

const traditionalOverrides: Record<string, string> = {
  車: "车",
};

export function generatePublicIdentifierSuggestion(merchantName: string) {
  const normalizedName = merchantName.normalize("NFKC").trim();
  if (!normalizedName) return "";

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
  let suggestion = romanized
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, PUBLIC_IDENTIFIER_MAX_LENGTH)
    .replace(/-+$/g, "");

  if (!suggestion) return "stall";
  if (suggestion.length < PUBLIC_IDENTIFIER_MIN_LENGTH) {
    suggestion = `${suggestion}-stall`;
  }
  return suggestion.slice(0, PUBLIC_IDENTIFIER_MAX_LENGTH).replace(/-+$/g, "");
}
