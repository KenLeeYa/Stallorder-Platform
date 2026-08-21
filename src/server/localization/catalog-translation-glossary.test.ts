import { describe, expect, it } from "vitest";
import {
  findCatalogGlossaryTermMatches,
  getCatalogGlossaryTranslation,
} from "./catalog-translation-glossary";

describe("findCatalogGlossaryTermMatches", () => {
  it("重疊時優先使用最長詞彙，並保留後續獨立短詞", () => {
    expect(findCatalogGlossaryTermMatches("預約取餐後再取餐", "en")).toEqual([
      {
        start: 0,
        end: 4,
        source: "預約取餐",
        translation: "Scheduled pickup",
      },
      {
        start: 6,
        end: 8,
        source: "取餐",
        translation: "Pickup",
      },
    ]);
  });

  it("找出句中重複出現的冬瓜茶", () => {
    expect(findCatalogGlossaryTermMatches("冬瓜茶與冬瓜茶", "vi")).toEqual([
      {
        start: 0,
        end: 3,
        source: "冬瓜茶",
        translation: "Trà bí đao",
      },
      {
        start: 4,
        end: 7,
        source: "冬瓜茶",
        translation: "Trà bí đao",
      },
    ]);
  });

  it.each([
    ["en", "Chilled traditional Winter Melon Tea."],
    ["ja", "昔ながらの冬瓜茶を冷たく仕上げました。"],
    ["ko", "시원하게 즐기는 전통 동과차입니다."],
    ["vi", "Trà bí đao truyền thống, dùng lạnh."],
    ["th", "ชาฟักเขียวสูตรดั้งเดิม เสิร์ฟเย็น"],
  ] as const)("%s 使用人工校訂的完整冬瓜茶說明", (locale, expected) => {
    expect(getCatalogGlossaryTranslation("冰涼古早味冬瓜茶。", locale)).toBe(expected);
  });
});
