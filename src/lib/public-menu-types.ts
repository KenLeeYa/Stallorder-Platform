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

export type PublicMenuProduct = {
  id: string;
  name: string;
  description: string;
  price: number;
  category: string;
  imageUrl: string | null;
  translations: Array<{ locale: string; name: string; description: string }>;
  noteGroups: PublicMenuNoteGroup[];
};

export type PublicMenu = {
  stall: {
    name: string;
    slug: string;
    location: string;
    currency: string;
    fulfillmentType: "TAKEOUT" | "DINE_IN" | "DELIVERY";
    table: { id: string; code: string; label: string } | null;
  };
  products: PublicMenuProduct[];
  supportedLocales: string[];
  estimatedWaitMinutes: number;
  lastTableOrderAt: null;
  limits: {
    maxItemQuantity: number;
    maxUniqueProducts: number;
    maxTotalQuantity: number;
    maxNoteLength: number;
  };
};
