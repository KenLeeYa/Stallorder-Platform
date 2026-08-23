import { describe, expect, it } from "vitest";
import { localizedCatalogName } from "./catalog-localization";

describe("catalog display localization", () => {
  const product = {
    name: "牛肉湯河粉",
    translations: [{ locale: "en", name: "Beef pho" }, { locale: "vi", name: "Phở bò" }],
  };

  it("uses the selected interface language", () => {
    expect(localizedCatalogName(product, "en")).toBe("Beef pho");
    expect(localizedCatalogName(product, "vi")).toBe("Phở bò");
  });

  it("falls back to the base name only when that locale is missing", () => {
    expect(localizedCatalogName(product, "ja")).toBe("牛肉湯河粉");
  });
});
