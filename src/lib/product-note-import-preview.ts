import { normalizedName, type ProductNoteTransfer } from "@/lib/product-note-transfer";

export type ResolvedProductNoteAssignment = {
  productId: string;
  productName: string;
  sortOrder: number;
};

type TranslationSnapshot = { locale: string; name: string };

export type ProductNoteImportExistingSnapshot = {
  reusableNotes: Array<{
    name: string;
    priceDelta: number;
    sortOrder: number;
    isActive: boolean;
    translations: TranslationSnapshot[];
  }>;
  groups: Array<{
    name: string;
    selectionMode: "SINGLE" | "MULTIPLE";
    isRequired: boolean;
    minSelections: number;
    maxSelections: number | null;
    sortOrder: number;
    isActive: boolean;
    translations: TranslationSnapshot[];
    assignments: Array<{
      productId: string;
      productName: string;
      sortOrder: number;
      isActive: boolean;
    }>;
    options: Array<{
      name: string;
      reusableNoteName: string | null;
      priceDelta: number;
      sortOrder: number;
      isActive: boolean;
      translations: TranslationSnapshot[];
    }>;
  }>;
};

export type ProductNoteImportPreviewChange = {
  field: string;
  before: string;
  after: string;
};

export type ProductNoteImportPreviewItem = {
  name: string;
  changeType: "CREATE" | "UPDATE";
  changes: ProductNoteImportPreviewChange[];
  additionalChangeCount: number;
};

export type ProductNoteImportPreviewGroup = ProductNoteImportPreviewItem & {
  productCount: number;
  optionCount: number;
};

export function buildProductNoteImportPreview(
  transfer: ProductNoteTransfer,
  assignmentsByGroup: ResolvedProductNoteAssignment[][],
  existing: ProductNoteImportExistingSnapshot,
) {
  const existingNotes = new Map(existing.reusableNotes.map((note) => [note.name, note]));
  const existingGroups = new Map(existing.groups.map((group) => [group.name, group]));
  const importedReusableNotes = new Map(
    transfer.reusableNotes.map((note) => [normalizedName(note.name), note]),
  );

  const reusableNotes = transfer.reusableNotes.map((note) => {
    const current = existingNotes.get(note.name);
    const changes: ProductNoteImportPreviewChange[] = [];
    if (current) {
      addChange(changes, "價格調整", money(current.priceDelta, transfer.sourceCurrency), money(note.priceDelta, transfer.sourceCurrency));
      addChange(changes, "排序", current.sortOrder, note.sortOrder);
      addChange(changes, "啟用狀態", status(current.isActive), status(note.isActive));
      addTranslationChanges(changes, current.translations, note.translations);
    }
    return previewItem(note.name, Boolean(current), changes);
  });

  const groups: ProductNoteImportPreviewGroup[] = transfer.groups.map((group, groupIndex) => {
    const current = existingGroups.get(group.name);
    const changes: ProductNoteImportPreviewChange[] = [];
    if (current) {
      addChange(changes, "選取方式", selectionMode(current.selectionMode), selectionMode(group.selectionMode));
      addChange(changes, "必選設定", required(current.isRequired), required(group.isRequired));
      addChange(changes, "最少選取數", current.minSelections, group.minSelections);
      addChange(changes, "最多選取數", nullableNumber(current.maxSelections), nullableNumber(group.maxSelections));
      addChange(changes, "排序", current.sortOrder, group.sortOrder);
      addChange(changes, "啟用狀態", status(current.isActive), status(group.isActive));
      addTranslationChanges(changes, current.translations, group.translations);
      addAssignmentChanges(changes, current.assignments, assignmentsByGroup[groupIndex] ?? []);
      addOptionChanges(changes, current.options, group.options, importedReusableNotes, transfer.sourceCurrency);
    }
    return {
      ...previewItem(group.name, Boolean(current), changes),
      productCount: group.products.length,
      optionCount: group.options.length,
    };
  });

  return {
    reusableNotes,
    groups,
    counts: {
      reusableNoteCreateCount: reusableNotes.filter((item) => item.changeType === "CREATE").length,
      reusableNoteUpdateCount: reusableNotes.filter((item) => item.changeType === "UPDATE").length,
      groupCreateCount: groups.filter((item) => item.changeType === "CREATE").length,
      groupUpdateCount: groups.filter((item) => item.changeType === "UPDATE").length,
    },
  };
}

function addAssignmentChanges(
  changes: ProductNoteImportPreviewChange[],
  currentAssignments: ProductNoteImportExistingSnapshot["groups"][number]["assignments"],
  importedAssignments: ResolvedProductNoteAssignment[],
) {
  const currentByProduct = new Map(currentAssignments.map((assignment) => [assignment.productId, assignment]));
  for (const assignment of importedAssignments) {
    const current = currentByProduct.get(assignment.productId);
    const label = `商品指派「${assignment.productName}」`;
    if (!current) {
      changes.push({ field: label, before: "不存在", after: `新增（排序 ${assignment.sortOrder}、啟用）` });
      continue;
    }
    addChange(changes, `${label}排序`, current.sortOrder, assignment.sortOrder);
    addChange(changes, `${label}啟用狀態`, status(current.isActive), "啟用");
  }
}

function addOptionChanges(
  changes: ProductNoteImportPreviewChange[],
  currentOptions: ProductNoteImportExistingSnapshot["groups"][number]["options"],
  importedOptions: ProductNoteTransfer["groups"][number]["options"],
  importedReusableNotes: ReadonlyMap<string, ProductNoteTransfer["reusableNotes"][number]>,
  currency: string,
) {
  const currentByName = new Map(currentOptions.map((option) => [option.name, option]));
  for (const option of importedOptions) {
    const reusable = option.reusableNoteName
      ? importedReusableNotes.get(normalizedName(option.reusableNoteName))
      : undefined;
    const optionName = reusable?.name ?? option.name;
    const current = currentByName.get(optionName);
    const label = `群組註記「${optionName}」`;
    if (!current) {
      changes.push({ field: label, before: "不存在", after: "新增" });
      continue;
    }
    addChange(
      changes,
      `${label}來源`,
      current.reusableNoteName ? `共用：${current.reusableNoteName}` : "群組專用",
      reusable ? `共用：${reusable.name}` : "群組專用",
    );
    addChange(
      changes,
      `${label}價格調整`,
      money(current.priceDelta, currency),
      money(reusable?.priceDelta ?? option.priceDelta, currency),
    );
    addChange(changes, `${label}排序`, current.sortOrder, option.sortOrder);
    addChange(changes, `${label}啟用狀態`, status(current.isActive), status(reusable?.isActive ?? option.isActive));
    if (!reusable) addTranslationChanges(changes, current.translations, option.translations, `${label}翻譯`);
  }
}

function addTranslationChanges(
  changes: ProductNoteImportPreviewChange[],
  currentTranslations: TranslationSnapshot[],
  importedTranslations: TranslationSnapshot[],
  fieldPrefix = "翻譯",
) {
  const currentByLocale = new Map(currentTranslations.map((translation) => [translation.locale, translation.name]));
  for (const translation of importedTranslations) {
    addChange(
      changes,
      `${fieldPrefix}（${translation.locale}）`,
      currentByLocale.get(translation.locale) ?? "尚未設定",
      translation.name,
    );
  }
}

function addChange(
  changes: ProductNoteImportPreviewChange[],
  field: string,
  before: string | number,
  after: string | number,
) {
  if (before === after) return;
  changes.push({ field, before: String(before), after: String(after) });
}

function previewItem(name: string, exists: boolean, changes: ProductNoteImportPreviewChange[]): ProductNoteImportPreviewItem {
  return {
    name,
    changeType: exists ? "UPDATE" : "CREATE",
    changes,
    additionalChangeCount: 0,
  };
}

function status(value: boolean) {
  return value ? "啟用" : "停用";
}

function required(value: boolean) {
  return value ? "必選" : "選填";
}

function selectionMode(value: "SINGLE" | "MULTIPLE") {
  return value === "SINGLE" ? "單選" : "複選";
}

function nullableNumber(value: number | null) {
  return value === null ? "不限" : String(value);
}

function money(value: number, currency: string) {
  return `${value} ${currency}`;
}
