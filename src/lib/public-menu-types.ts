export type PublicMenuNoteOption = {
  id: string;
  name: string;
  priceDelta: number;
  sortOrder: number;
  translations: Array<{ locale: string; name: string }>;
};

export type PublicMenuNoteGroup = {
  id: string;
  name: string;
  selectionMode: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  sortOrder: number;
  translations: Array<{ locale: string; name: string }>;
  options: PublicMenuNoteOption[];
};

export type PublicMenuBundleChoiceOption = {
  id: string;
  componentProductId: string;
  componentProductName: string;
  quantity: number;
  priceDelta: number;
  sortOrder: number;
  availableFrom?: string | null;
  availableUntil?: string | null;
};

export type PublicMenuBundleChoiceGroup = {
  id: string;
  name: string;
  minSelections: number;
  maxSelections: number;
  sortOrder: number;
  options: PublicMenuBundleChoiceOption[];
};

export type PublicMenuProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  kind: "SINGLE" | "BUNDLE";
  category: string;
  categoryTranslations?: Array<{ locale: string; name: string }>;
  group?: string | null;
  groupTranslations?: Array<{ locale: string; name: string }>;
  rank: number | null;
  isBestSeller: boolean;
  isSoldOut: boolean;
  isOrderDiscountEligible: boolean;
  imageUrl: string | null;
  availableFrom?: string | null;
  availableUntil?: string | null;
  translations: Array<{ locale: string; name: string; description: string }>;
  noteGroups: PublicMenuNoteGroup[];
  bundleChoiceGroups: PublicMenuBundleChoiceGroup[];
};

export type PublicMenu = {
  orderingMode: "DEFAULT" | "DELIVERY" | "PREORDER";
  preorderSlots: string[];
  lotteryEnabled: boolean;
  lotteryReward?: {
    spendEnabled: boolean;
    spendThresholdAmount: number;
    festivalEnabled: boolean;
    festivalActive: boolean;
  };
  specialClosure?: {
    id: string;
    startsOn: string;
    endsOn: string;
    title: string;
    message: string;
    isActive: boolean;
  } | null;
  stall: {
    name: string;
    slug: string;
    location: string;
    address?: string;
    currency: string;
    timezone: string;
    coverImageUrl?: string | null;
    locationGuideImageUrl?: string | null;
    coverImagePositionX?: number;
    coverImagePositionY?: number;
    coverImageZoom?: number;
    fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
    table: { id: string; code: string; label: string } | null;
  };
  products: PublicMenuProduct[];
  supportedLocales: string[];
  estimatedWaitMinutes: number;
  estimatedWaitMinMinutes: number;
  estimatedWaitMaxMinutes: number;
  waitAcknowledgmentThresholdMinutes: number | null;
  requiresWaitAcknowledgment: boolean;
  lastTableOrderAt: string | null;
  limits: {
    maxItemQuantity: number;
    maxUniqueProducts: number;
    maxTotalQuantity: number;
    maxNoteLength: number;
  };
};
