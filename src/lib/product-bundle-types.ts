export const productKinds = ["SINGLE", "BUNDLE"] as const;
export const MAX_BUNDLE_CHOICES_PER_ORDER_ITEM = 50;

export type ProductKindValue = (typeof productKinds)[number];

export type ProductBundleComponentView = {
  id: string;
  name: string;
  kind: ProductKindValue;
  isActive: boolean;
};

export type ProductBundleChoiceView = {
  id: string;
  choiceGroupId: string;
  componentProductId: string;
  quantity: number;
  priceDelta: number;
  isEnabled: boolean;
  sortOrder: number;
  componentProduct: ProductBundleComponentView;
};

export type ProductBundleChoiceGroupView = {
  id: string;
  bundleProductId: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  choices: ProductBundleChoiceView[];
};

export type ProductBundleDefinition = {
  id: string;
  organizationId: string;
  name: string;
  defaultPrice: number;
  kind: "BUNDLE";
  isActive: boolean;
  choiceGroups: ProductBundleChoiceGroupView[];
};
