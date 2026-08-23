import { createRef, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { qrOrderMessages } from "@/lib/qr-order-i18n";
import { QrOrderMenu } from "./qr-order-menu";

type MenuProps = ComponentProps<typeof QrOrderMenu>;

const product = {
  id: "meal",
  name: "招牌餐",
  description: "每日現做",
  price: 120,
  kind: "SINGLE" as const,
  category: "main",
  rank: 1,
  isBestSeller: true,
  isOrderDiscountEligible: false,
  imageUrl: null,
  translations: [],
  noteGroups: [{
    id: "spice",
    name: "辣度",
    selectionMode: "SINGLE" as const,
    isRequired: true,
    minSelections: 1,
    maxSelections: 1,
    sortOrder: 0,
    translations: [],
    options: [{
      id: "mild",
      name: "小辣",
      priceDelta: 10,
      sortOrder: 0,
      translations: [],
    }],
  }],
  bundleChoiceGroups: [{
    id: "side",
    name: "配菜",
    minSelections: 0,
    maxSelections: 1,
    sortOrder: 0,
    options: [{
      id: "egg",
      componentProductId: "egg-product",
      componentProductName: "荷包蛋",
      quantity: 1,
      priceDelta: 15,
      sortOrder: 0,
    }],
  }],
};

const baseProps: MenuProps = {
  categories: ["main"],
  visibleProducts: [product],
  activeOrderingMode: "DEFAULT",
  scheduledPickupAt: "",
  currency: "TWD",
  locale: "zh-TW",
  copy: qrOrderMessages["zh-TW"],
  orderingEnabled: true,
  cartLines: [{
    id: "line-meal",
    productId: product.id,
    quantity: 2,
    note: "",
    noteOptionIds: ["mild"],
    bundleChoiceIds: [],
  }],
  productDrafts: {},
  editingLineIds: {},
  configuringProductId: null,
  sessionExpiryDialogOpen: false,
  configurationRef: createRef<HTMLElement>(),
  localizedCategory: (category) => category === "main" ? "主餐" : category,
  localizedProductGroup: (item) => item.group ?? "",
  localizedProduct: (item) => ({ name: item.name, description: item.description }),
  localizedGroupName: (group) => group.name,
  localizedOptionName: (option) => option.name,
  bundleChoiceLabel: (option) => option.componentProductName,
  onUpdateQuantity: vi.fn(),
  onCancelConfiguration: vi.fn(),
  onSelectNoteOption: vi.fn(),
  onSelectBundleChoice: vi.fn(),
  onAddProduct: vi.fn(),
};

function renderMenu(overrides: Partial<MenuProps> = {}) {
  return renderToStaticMarkup(<QrOrderMenu {...baseProps} {...overrides} />);
}

describe("QrOrderMenu presentation", () => {
  it("preserves category navigation, product semantics, badges, and compact mobile classes", () => {
    const html = renderMenu();

    expect(html).toContain(`<nav aria-label="${baseProps.copy.categoryNavigation}"`);
    expect(html).toContain('href="#qr-category-0"');
    expect(html).toContain('id="qr-category-0" class="scroll-mt-16"');
    expect(html).toContain('id="qr-product-meal"');
    expect(html).toContain('data-best-seller-rank="1"');
    expect(html).toContain('data-testid="best-seller-badge"');
    expect(html).toContain('data-testid="discount-ineligible-badge"');
    expect(html).toContain('grid-cols-[56px_minmax(0,1fr)]');
    expect(html).toContain('sm:grid-cols-[80px_minmax(0,1fr)_auto]');
    expect(html).toContain(`aria-label="${baseProps.copy.decrease(product.name)}"`);
    expect(html).toContain(`aria-label="${baseProps.copy.increase(product.name)}"`);
    expect(html).toContain(baseProps.copy.cartProductQuantity(2));
  });

  it("preserves the product configuration dialog contract and required-selection state", () => {
    const html = renderMenu({
      configuringProductId: product.id,
      productDrafts: {
        [product.id]: {
          quantity: 1,
          noteOptionIds: [],
          bundleChoiceIds: [],
        },
      },
      editingLineIds: { [product.id]: "line-meal" },
    });

    expect(html).toContain('role="dialog"');
    expect(html).toContain('aria-modal="true"');
    expect(html).toContain('aria-labelledby="qr-product-configuration-meal"');
    expect(html).toContain('data-testid="qr-product-configuration"');
    expect(html).toContain('safe-area-bottom fixed inset-x-0 bottom-0');
    expect(html).toContain('max-h-[88dvh]');
    expect(html).toContain('name="note-meal-spice"');
    expect(html).toContain('name="bundle-meal-side"');
    expect(html).toContain('id="qr-product-action-meal"');
    expect(html).toContain(baseProps.copy.finishEditingCartItem);
    expect(html).toContain(baseProps.copy.requiredNotes(product.name));
  });

  it("renders both preorder empty-state messages without changing their status semantics", () => {
    const selectTime = renderMenu({
      categories: [],
      visibleProducts: [],
      activeOrderingMode: "PREORDER",
      scheduledPickupAt: "",
    });
    const unavailable = renderMenu({
      categories: [],
      visibleProducts: [],
      activeOrderingMode: "PREORDER",
      scheduledPickupAt: "2026-08-13T02:00:00.000Z",
    });

    expect(selectTime).toContain('role="status"');
    expect(selectTime).toContain("請先確認並套用預約取餐時間，完成後才會顯示可點商品。");
    expect(unavailable).toContain('role="status"');
    expect(unavailable).toContain("此時段暫無可預約商品，請選擇其他取餐時間。");
  });
});
