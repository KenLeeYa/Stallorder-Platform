"use client";

import { useMerchantMessages } from "@/lib/messages/merchant-client";
import type { MessageValues } from "@/lib/message-catalog";
import type { MerchantMessageKey } from "@/lib/messages/merchant";
import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Check,
  ChevronDown,
  Copy,
  Download,
  Eye,
  EyeOff,
  ImageUp,
  Languages,
  PackageOpen,
  Pencil,
  Plus,
  Save,
  Sparkles,
  Store,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { ProductImage } from "@/components/product-image";
import { csrfFormHeaders, csrfHeaders } from "@/lib/csrf-client";
import { buildCatalogCsvErrorReport, type CatalogCsvRowError } from "@/lib/catalog-csv-client";
import {
  getTranslationLocaleOptions,
  type TranslationLocale,
} from "@/lib/enabled-locales";
import {
  focusFirstInvalidField,
  parseFieldErrors,
  withoutFieldError,
} from "@/lib/form-field-errors";
import { formatMoney as formatRawMoney } from "@/lib/money";
import {
  ProductNoteGroupsManager,
  type ProductNoteGroupView,
  type ReusableProductNoteView,
} from "@/components/product-note-groups-manager";
import type {
  ProductBundleChoiceGroupView,
  ProductBundleChoiceView,
  ProductKindValue,
} from "@/lib/product-bundle-types";

type Category = { id: string; name: string; sortOrder: number; isActive: boolean };
type Group = { id: string; categoryId: string; name: string; sortOrder: number; isActive: boolean };
type Assignment = {
  id: string;
  stallId: string;
  priceOverride: number | null;
  isEnabled: boolean;
  isSoldOut: boolean;
  sortOrder: number;
};
type Product = {
  id: string;
  categoryId: string;
  groupId: string | null;
  name: string;
  description: string;
  defaultPrice: number;
  kind: ProductKindValue;
  imageUrl: string | null;
  isOrderDiscountEligible: boolean;
  isLotteryEligible: boolean;
  sortOrder: number;
  isActive: boolean;
  translations: Array<{ locale: string; name: string; description: string }>;
  stallProducts: Assignment[];
  bundleChoiceGroups: ProductBundleChoiceGroupView[];
};
type Catalog = { categories: Category[]; groups: Group[]; products: Product[] };
type Stall = { id: string; name: string; isActive: boolean };
type CategoryDraft = Omit<Category, "id"> & { id?: string };
type GroupDraft = Omit<Group, "id"> & { id?: string };
type ProductDraft = Omit<Product, "id" | "stallProducts" | "bundleChoiceGroups" | "defaultPrice"> & {
  id?: string;
  stallIds: string[];
  defaultPrice: number | "";
};
type BundleChoiceGroupDraft = Omit<ProductBundleChoiceGroupView, "id" | "choices"> & { id?: string };
type BundleChoiceDraft = Omit<ProductBundleChoiceView, "id" | "componentProduct" | "priceDelta"> & {
  id?: string;
  priceDelta: number | "";
};
type ImportPreview = {
  file: File;
  totalCount: number;
  validCount: number;
  invalidCount: number;
  previewRows: Array<{ id: string | null; category: string; group: string | null; name: string; price: number; stallCodes: string[] }>;
  errors: CatalogCsvRowError[];
};

type BundleComponentIssue = {
  stallId: string;
  stallName: string;
  reason: string;
};

type BundleStallVisibility = {
  stallId: string;
  stallName: string;
  visible: boolean;
  reasons: string[];
};

type TranslateLabel = (value: string) => string;
type TranslateMessage = (key: MerchantMessageKey, values?: MessageValues) => string;

function productUnavailableReason(
  product: Product | undefined,
  stallId: string,
  categories: Category[],
) {
  if (!product) return "商品不存在";
  if (!product.isActive) return "商品已停用";
  if (categories.find((category) => category.id === product.categoryId)?.isActive === false) {
    return "商品分類已停用";
  }
  const assignment = product.stallProducts.find((item) => item.stallId === stallId);
  if (!assignment) return "未分派";
  if (!assignment.isEnabled) return "分派未啟用";
  if (assignment.isSoldOut) return "已售罄";
  return null;
}

function getBundleComponentIssues(
  bundleProduct: Product,
  componentProduct: Product | undefined,
  stalls: Stall[],
  categories: Category[],
  translateLabel: TranslateLabel,
): BundleComponentIssue[] {
  return bundleProduct.stallProducts.flatMap((assignment) => {
    const reason = productUnavailableReason(componentProduct, assignment.stallId, categories);
    if (!reason) return [];
    return [{
      stallId: assignment.stallId,
      stallName: stalls.find((stall) => stall.id === assignment.stallId)?.name ?? assignment.stallId,
      reason: translateLabel(reason),
    }];
  });
}

function getBundleStallVisibility(
  bundleProduct: Product,
  products: Product[],
  stalls: Stall[],
  categories: Category[],
  translateLabel: TranslateLabel,
  translateMessage: TranslateMessage,
): BundleStallVisibility[] {
  return bundleProduct.stallProducts.map((assignment) => {
    const stall = stalls.find((item) => item.id === assignment.stallId);
    const reasons = new Set<string>();
    if (!bundleProduct.isActive) reasons.add(translateLabel("套餐已停用"));
    if (categories.find((category) => category.id === bundleProduct.categoryId)?.isActive === false) {
      reasons.add(translateLabel("套餐分類已停用"));
    }
    if (!stall?.isActive) reasons.add(translateLabel("攤位已停用"));
    if (!assignment.isEnabled) reasons.add(translateLabel("套餐分派未啟用"));
    if (assignment.isSoldOut) reasons.add(translateLabel("套餐已售罄"));
    if (bundleProduct.bundleChoiceGroups.length === 0) reasons.add(translateLabel("尚未設定套餐群組"));

    for (const group of bundleProduct.bundleChoiceGroups) {
      const availableCount = group.choices.filter((choice) => (
        choice.isEnabled
        && !productUnavailableReason(
          products.find((product) => product.id === choice.componentProductId),
          assignment.stallId,
          categories,
        )
      )).length;
      const requiredCount = group.minSelections;
      if (availableCount < requiredCount) {
        reasons.add(translateMessage("「{value0}」至少需 {value1} 個可用商品，目前 {value2} 個", { value0: group.name, value1: requiredCount, value2: availableCount }));
      }
    }

    return {
      stallId: assignment.stallId,
      stallName: stall?.name ?? assignment.stallId,
      visible: reasons.size === 0,
      reasons: [...reasons],
    };
  });
}

function bundleComponentOptionLabel(
  product: Product,
  issues: BundleComponentIssue[],
  assignedStallCount: number,
  translateMessage: TranslateMessage,
) {
  if (assignedStallCount === 0) return translateMessage("{value0}（套餐尚未分派攤位）", { value0: product.name });
  if (issues.length === 0) return product.name;
  if (assignedStallCount === 1) {
    return `${product.name}（${issues[0]?.stallName}：${issues[0]?.reason}）`;
  }
  return translateMessage("{value0}（{value1}/{value2} 個套餐攤位不可用）", { value0: product.name, value1: issues.length, value2: assignedStallCount });
}

export function SharedCatalogManager({
  organizationId,
  currency,
  stalls,
  initialCatalog,
  initialNoteGroups,
  initialReusableNotes,
  enabledTranslationLocales,
  aiTranslationConfigured,
}: {
  organizationId: string;
  currency: string;
  stalls: Stall[];
  initialCatalog: Catalog;
  initialNoteGroups: ProductNoteGroupView[];
  initialReusableNotes: ReusableProductNoteView[];
  enabledTranslationLocales: TranslationLocale[];
  aiTranslationConfigured: boolean;
}) {
  const { locale, m, label } = useMerchantMessages();
  const formatMoney = (amount: number, selectedCurrency = currency) => formatRawMoney(amount, selectedCurrency, locale);
  const [catalog, setCatalog] = useState(initialCatalog);
  const [catalogOpen, setCatalogOpen] = useState(true);
  const [collapsedCategoryIds, setCollapsedCategoryIds] = useState<Set<string>>(new Set());
  const [noteGroups, setNoteGroups] = useState(initialNoteGroups);
  const [reusableNotes, setReusableNotes] = useState(initialReusableNotes);
  const [noteGroupsRevision, setNoteGroupsRevision] = useState(0);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const [assignmentProduct, setAssignmentProduct] = useState<Product | null>(null);
  const [assignmentStallIds, setAssignmentStallIds] = useState<string[]>([]);
  const [bundleProductId, setBundleProductId] = useState<string | null>(null);
  const [bundleChoiceGroupDraft, setBundleChoiceGroupDraft] = useState<BundleChoiceGroupDraft | null>(null);
  const [bundleChoiceDraft, setBundleChoiceDraft] = useState<BundleChoiceDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editorMessage, setEditorMessage] = useState("");
  const [editorFieldErrors, setEditorFieldErrors] = useState<Record<string, string>>({});
  const [bundleMessage, setBundleMessage] = useState("");
  const [bundleFieldErrors, setBundleFieldErrors] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLElement>(null);
  const bundleEditorRef = useRef<HTMLElement>(null);
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [aiTranslating, setAiTranslating] = useState(false);
  const translationOptions = getTranslationLocaleOptions(enabledTranslationLocales);
  const bundleProduct = bundleProductId
    ? catalog.products.find((product) => product.id === bundleProductId && product.kind === "BUNDLE") ?? null
    : null;
  const singleProducts = catalog.products.filter((product) => product.kind === "SINGLE");
  const bundleStallVisibility = bundleProduct
    ? getBundleStallVisibility(bundleProduct, catalog.products, stalls, catalog.categories, label, m)
    : [];
  const selectedBundleComponent = bundleChoiceDraft
    ? singleProducts.find((product) => product.id === bundleChoiceDraft.componentProductId)
    : undefined;
  const selectedBundleComponentIssues = bundleProduct && selectedBundleComponent
    ? getBundleComponentIssues(bundleProduct, selectedBundleComponent, stalls, catalog.categories, label)
    : [];

  const sortedCategories = useMemo(
    () => [...catalog.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-TW")),
    [catalog.categories],
  );
  const allProductsExpanded = catalogOpen
    && sortedCategories.every((category) => !collapsedCategoryIds.has(category.id));

  function toggleAllProducts() {
    const expand = !allProductsExpanded;
    setCatalogOpen(expand);
    setCollapsedCategoryIds(expand
      ? new Set()
      : new Set(sortedCategories.map((category) => category.id)));
  }

  function clearBundleFeedback() {
    setBundleMessage("");
    setBundleFieldErrors({});
  }

  function clearEditorFeedback() {
    setEditorMessage("");
    setEditorFieldErrors({});
  }

  function clearEditorField(field: string) {
    setEditorFieldErrors((current) => withoutFieldError(current, field));
  }

  function clearBundleField(field: string) {
    setBundleFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function runCommand(
    command: Record<string, unknown>,
    successMessage: string,
    feedbackTarget: "page" | "editor" | "bundle" = "page",
  ) {
    setBusy(true);
    if (feedbackTarget === "bundle") clearBundleFeedback();
    else if (feedbackTarget === "editor") clearEditorFeedback();
    else setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/catalog`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as { error?: string; fieldErrors?: unknown; catalog: Catalog };
      if (!response.ok) {
        const errorMessage = payload.error ?? label("目前無法更新商品主檔。");
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        if (feedbackTarget === "bundle") {
          setBundleMessage(errorMessage);
          setBundleFieldErrors(nextFieldErrors);
          focusFirstInvalidField(bundleEditorRef.current, nextFieldErrors);
        } else if (feedbackTarget === "editor") {
          setEditorMessage(errorMessage);
          setEditorFieldErrors(nextFieldErrors);
          focusFirstInvalidField(editorRef.current, nextFieldErrors);
        } else {
          setMessage(errorMessage);
        }
        return false;
      }
      setCatalog(payload.catalog);
      setMessage(successMessage);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : label("網路連線中斷，請稍後再試。");
      if (feedbackTarget === "bundle") setBundleMessage(errorMessage);
      else if (feedbackTarget === "editor") setEditorMessage(errorMessage);
      else setMessage(errorMessage);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function translateMissingContent() {
    const confirmed = window.confirm(
      label("將把已啟用商品與註記的繁體中文名稱、說明傳送至 OpenAI，補齊目前啟用語系的缺漏翻譯。既有人工翻譯不會被覆蓋。確定執行？"),
    );
    if (!confirmed) return;
    setAiTranslating(true);
    setMessage("");
    try {
      const response = await fetch(
        `/api/merchant/organizations/${organizationId}/catalog/translate`,
        {
          method: "POST",
          headers: csrfHeaders(),
          body: JSON.stringify({ mode: "MISSING_ONLY" }),
        },
      );
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? label("目前無法完成 AI 翻譯。"));
      setCatalog(payload.catalog);
      setNoteGroups(payload.noteGroups);
      setReusableNotes(payload.reusableNotes);
      setNoteGroupsRevision((current) => current + 1);
      const translatedFields = Number(payload.summary?.translatedFields ?? 0);
      setMessage(
        translatedFields > 0
          ? m("AI 翻譯已完成，共補齊 {value0} 個缺漏欄位。", { value0: translatedFields })
          : label("目前啟用的語系皆已完成翻譯。"),
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("目前無法完成 AI 翻譯。"));
    } finally {
      setAiTranslating(false);
    }
  }

  function createCategory() {
    clearEditorFeedback();
    setCategoryDraft({ name: "", sortOrder: catalog.categories.length + 1, isActive: true });
  }

  function createGroup() {
    clearEditorFeedback();
    setGroupDraft({
      categoryId: sortedCategories[0].id,
      name: "",
      sortOrder: catalog.groups.length + 1,
      isActive: true,
    });
  }

  function editCategory(category: Category) {
    clearEditorFeedback();
    setCategoryDraft({ ...category });
  }

  function editGroup(group: Group) {
    clearEditorFeedback();
    setGroupDraft({ ...group });
  }

  function editProduct(product: Product) {
    clearEditorFeedback();
    setProductDraft({ ...product, stallIds: [] });
  }

  function createProduct(kind: ProductKindValue = "SINGLE") {
    clearEditorFeedback();
    const category = sortedCategories.find((item) => item.isActive);
    if (!category) {
      setMessage(label("請先建立可用的商品分類。"));
      setCategoryDraft({ name: "", sortOrder: catalog.categories.length + 1, isActive: true });
      return;
    }
    const group = catalog.groups.find((item) => item.categoryId === category.id && item.isActive);
    const activeStalls = stalls.filter((stall) => stall.isActive);
    setProductDraft({
      categoryId: category.id,
      groupId: group?.id ?? null,
      name: "",
      description: "",
      defaultPrice: "",
      kind,
      imageUrl: null,
      isOrderDiscountEligible: true,
      isLotteryEligible: true,
      sortOrder: catalog.products.length + 1,
      isActive: true,
      stallIds: activeStalls.length === 1 ? [activeStalls[0]!.id] : [],
      translations: [],
    });
  }

  async function saveCategory(event: FormEvent) {
    event.preventDefault();
    if (!categoryDraft) return;
    const ok = await runCommand(
      categoryDraft.id
        ? { operation: "UPDATE_CATEGORY", categoryId: categoryDraft.id, name: categoryDraft.name, sortOrder: categoryDraft.sortOrder, isActive: categoryDraft.isActive }
        : { operation: "CREATE_CATEGORY", name: categoryDraft.name, sortOrder: categoryDraft.sortOrder },
      categoryDraft.id ? label("分類已更新。") : label("分類已新增。"),
      "editor",
    );
    if (ok) setCategoryDraft(null);
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    if (!groupDraft) return;
    const ok = await runCommand(
      groupDraft.id
        ? { operation: "UPDATE_GROUP", groupId: groupDraft.id, categoryId: groupDraft.categoryId, name: groupDraft.name, sortOrder: groupDraft.sortOrder, isActive: groupDraft.isActive }
        : {
          operation: "CREATE_GROUP",
          categoryId: groupDraft.categoryId,
          name: groupDraft.name,
          sortOrder: groupDraft.sortOrder,
        },
      groupDraft.id ? label("群組已更新。") : label("群組已新增。"),
      "editor",
    );
    if (ok) setGroupDraft(null);
  }

  async function saveProduct(event: FormEvent) {
    event.preventDefault();
    if (!productDraft) return;
    const data = {
      categoryId: productDraft.categoryId,
      groupId: productDraft.groupId,
      name: productDraft.name,
      description: productDraft.description,
      defaultPrice: productDraft.defaultPrice,
      kind: productDraft.kind,
      imageUrl: productDraft.imageUrl || null,
      isOrderDiscountEligible: productDraft.isOrderDiscountEligible,
      isLotteryEligible: productDraft.isLotteryEligible,
      sortOrder: productDraft.sortOrder,
      translations: productDraft.translations.filter((translation) => translation.name.trim()),
    };
    const ok = await runCommand(
      productDraft.id
        ? { operation: "UPDATE_PRODUCT", productId: productDraft.id, ...data, isActive: productDraft.isActive }
        : { operation: "CREATE_PRODUCT", ...data, stallIds: productDraft.stallIds },
      productDraft.id ? label("商品已更新。") : label("商品已新增。"),
      "editor",
    );
    if (ok) setProductDraft(null);
  }

  async function previewCatalogImport(file: File) {
    const form = new FormData();
    form.set("catalog", file);
    form.set("mode", "PREVIEW");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/catalog/import`, {
        method: "POST",
        headers: csrfFormHeaders(),
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? label("商品匯入失敗。"));
      setImportPreview({ file, ...payload });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("商品匯入失敗。"));
    } finally {
      setBusy(false);
    }
  }

  async function applyCatalogImport() {
    if (!importPreview || importPreview.validCount === 0) return;
    const form = new FormData();
    form.set("catalog", importPreview.file);
    form.set("mode", "APPLY");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/catalog/import`, {
        method: "POST",
        headers: csrfFormHeaders(),
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? label("商品匯入失敗。"));
      setCatalog(payload.catalog);
      setImportPreview(null);
      setMessage(m("已套用 {value0} 筆商品{value1}。", { value0: payload.importedCount, value1: payload.skippedCount > 0 ? m("，略過 {value0} 筆錯誤資料", { value0: payload.skippedCount }) : "" }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("商品匯入失敗。"));
    } finally {
      setBusy(false);
    }
  }

  function downloadImportErrors() {
    if (!importPreview || importPreview.errors.length === 0) return;
    const content = `\uFEFF${buildCatalogCsvErrorReport(importPreview.errors)}`;
    const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "stallorder-catalog-import-errors.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  async function uploadProductImage(file: File) {
    if (!productDraft) return;
    const form = new FormData();
    form.set("image", file);
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/catalog/image`, {
        method: "POST",
        headers: csrfFormHeaders(),
        body: form,
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? label("圖片上傳失敗。"));
      setProductDraft((current) => current ? { ...current, imageUrl: payload.imageUrl } : current);
      setMessage(label("商品圖片已上傳，儲存商品後生效。"));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : label("圖片上傳失敗。"));
    } finally {
      setBusy(false);
    }
  }

  function updateTranslation(locale: string, changes: { name?: string; description?: string }) {
    if (!productDraft) return;
    const existing = productDraft.translations.find((translation) => translation.locale === locale)
      ?? { locale, name: "", description: "" };
    setProductDraft({
      ...productDraft,
      translations: [
        ...productDraft.translations.filter((translation) => translation.locale !== locale),
        { ...existing, ...changes },
      ],
    });
  }

  async function toggleActive(kind: "CATEGORY" | "GROUP" | "PRODUCT", item: Category | Group | Product) {
    const nextActive = !item.isActive;
    if (!nextActive && !window.confirm(m("確定停用「{value0}」？商品與歷史訂單資料仍會保留。", { value0: item.name }))) return;
    if (kind === "CATEGORY") {
      await runCommand({ operation: "UPDATE_CATEGORY", categoryId: item.id, name: item.name, sortOrder: item.sortOrder, isActive: nextActive }, nextActive ? label("分類已恢復。") : label("分類已停用。"));
    } else if (kind === "GROUP") {
      const group = item as Group;
      await runCommand({ operation: "UPDATE_GROUP", groupId: group.id, categoryId: group.categoryId, name: group.name, sortOrder: group.sortOrder, isActive: nextActive }, nextActive ? label("群組已恢復。") : label("群組已停用。"));
    } else {
      const product = item as Product;
      await runCommand({ operation: "UPDATE_PRODUCT", productId: product.id, categoryId: product.categoryId, groupId: product.groupId, name: product.name, description: product.description, defaultPrice: product.defaultPrice, kind: product.kind, imageUrl: product.imageUrl, sortOrder: product.sortOrder, isActive: nextActive, translations: product.translations }, nextActive ? label("商品已恢復。") : label("商品已停用並停止各攤供應。"));
    }
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(m("確定永久刪除「{value0}」？各攤供應與翻譯會一併移除，歷史訂單仍保留商品快照。", { value0: product.name }))) return;
    await runCommand(
      { operation: "DELETE_PRODUCT", productId: product.id },
      label("商品已刪除，歷史訂單快照已保留。"),
    );
  }

  async function cloneProduct(product: Product) {
    await runCommand(
      { operation: "CLONE_PRODUCT", productId: product.id },
      m("已建立「{value0}」副本，翻譯、註記、套餐內容與攤位分派已一併複製。", { value0: product.name }),
    );
  }

  function openAssignments(product: Product) {
    clearEditorFeedback();
    setAssignmentProduct(product);
    setAssignmentStallIds(product.stallProducts.map((assignment) => assignment.stallId));
  }

  async function saveAssignments() {
    if (!assignmentProduct) return;
    const ok = await runCommand(
      { operation: "SET_ASSIGNMENTS", productId: assignmentProduct.id, stallIds: assignmentStallIds },
      label("攤位分派已更新。"),
      "editor",
    );
    if (ok) setAssignmentProduct(null);
  }

  function openBundle(product: Product) {
    clearBundleFeedback();
    setBundleProductId(product.id);
    setBundleChoiceGroupDraft(null);
    setBundleChoiceDraft(null);
  }

  function editBundleChoiceGroup(choiceGroup: ProductBundleChoiceGroupView) {
    clearBundleFeedback();
    setBundleChoiceDraft(null);
    setBundleChoiceGroupDraft({
      id: choiceGroup.id,
      bundleProductId: choiceGroup.bundleProductId,
      name: choiceGroup.name,
      minSelections: choiceGroup.minSelections,
      maxSelections: choiceGroup.maxSelections,
      sortOrder: choiceGroup.sortOrder,
    });
  }

  async function saveBundleChoiceGroup(event: FormEvent) {
    event.preventDefault();
    if (!bundleChoiceGroupDraft) return;
    const data = {
      name: bundleChoiceGroupDraft.name,
      minSelections: bundleChoiceGroupDraft.minSelections,
      maxSelections: bundleChoiceGroupDraft.maxSelections,
      sortOrder: bundleChoiceGroupDraft.sortOrder,
    };
    const ok = await runCommand(
      bundleChoiceGroupDraft.id
        ? {
          operation: "UPDATE_BUNDLE_CHOICE_GROUP",
          choiceGroupId: bundleChoiceGroupDraft.id,
          ...data,
        }
        : {
          operation: "CREATE_BUNDLE_CHOICE_GROUP",
          bundleProductId: bundleChoiceGroupDraft.bundleProductId,
          ...data,
        },
      bundleChoiceGroupDraft.id ? label("套餐選擇群組已更新。") : label("套餐選擇群組已新增。"),
      "bundle",
    );
    if (ok) setBundleChoiceGroupDraft(null);
  }

  async function deleteBundleChoiceGroup(choiceGroup: ProductBundleChoiceGroupView) {
    if (!window.confirm(m("確定刪除套餐群組「{value0}」？群組內選項會一併移除。", { value0: choiceGroup.name }))) return;
    await runCommand(
      { operation: "DELETE_BUNDLE_CHOICE_GROUP", choiceGroupId: choiceGroup.id },
      label("套餐選擇群組已刪除。"),
      "bundle",
    );
  }

  function createBundleChoice(choiceGroupId: string) {
    clearBundleFeedback();
    const component = singleProducts.find((product) => product.isActive) ?? singleProducts[0];
    const choiceGroup = bundleProduct?.bundleChoiceGroups.find((group) => group.id === choiceGroupId);
    if (!component) {
      setMessage(label("請先建立一般商品，才能加入套餐選項。"));
      return;
    }
    setBundleChoiceGroupDraft(null);
    setBundleChoiceDraft({
      choiceGroupId,
      componentProductId: component.id,
      quantity: 1,
      priceDelta: "",
      isEnabled: true,
      sortOrder: (choiceGroup?.choices.length ?? 0) + 1,
    });
  }

  function editBundleChoice(choice: ProductBundleChoiceView) {
    clearBundleFeedback();
    setBundleChoiceGroupDraft(null);
    setBundleChoiceDraft({
      id: choice.id,
      choiceGroupId: choice.choiceGroupId,
      componentProductId: choice.componentProductId,
      quantity: choice.quantity,
      priceDelta: choice.priceDelta,
      isEnabled: choice.isEnabled,
      sortOrder: choice.sortOrder,
    });
  }

  async function saveBundleChoice(event: FormEvent) {
    event.preventDefault();
    if (!bundleChoiceDraft) return;
    const data = {
      choiceGroupId: bundleChoiceDraft.choiceGroupId,
      componentProductId: bundleChoiceDraft.componentProductId,
      quantity: bundleChoiceDraft.quantity,
      priceDelta: bundleChoiceDraft.priceDelta === "" ? 0 : bundleChoiceDraft.priceDelta,
      isEnabled: bundleChoiceDraft.isEnabled,
      sortOrder: bundleChoiceDraft.sortOrder,
    };
    const ok = await runCommand(
      bundleChoiceDraft.id
        ? { operation: "UPDATE_BUNDLE_CHOICE", choiceId: bundleChoiceDraft.id, ...data }
        : { operation: "CREATE_BUNDLE_CHOICE", ...data },
      bundleChoiceDraft.id ? label("套餐選項已更新。") : label("套餐選項已新增。"),
      "bundle",
    );
    if (ok) setBundleChoiceDraft(null);
  }

  async function deleteBundleChoice(choice: ProductBundleChoiceView) {
    if (!window.confirm(m("確定移除套餐選項「{value0}」？", { value0: choice.componentProduct.name }))) return;
    await runCommand(
      { operation: "DELETE_BUNDLE_CHOICE", choiceId: choice.id },
      label("套餐選項已移除。"),
      "bundle",
    );
  }

  function productsFor(categoryId: string, groupId: string | null) {
    return catalog.products.filter((product) => product.categoryId === categoryId && product.groupId === groupId);
  }

  return (
    <section aria-labelledby="shared-catalog-heading">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <p className="text-sm font-semibold text-teal-800">{label("組織商品主檔")}</p>
          <h1 id="shared-catalog-heading" className="mt-1 text-3xl font-semibold">{label("共用商品")}</h1>
          <p className="mt-2 text-sm text-stone-600">{label("一次建立分類、群組與商品，再分派到一個或多個攤位。")}</p>
        </div>
        <div data-testid="shared-catalog-actions" className="flex w-full flex-col gap-2 lg:w-auto">
          <div data-testid="shared-catalog-tools" className="flex flex-wrap gap-2 lg:justify-end">
            <button type="button" data-testid="shared-products-toggle-all" aria-expanded={allProductsExpanded} aria-controls="shared-product-catalog" onClick={toggleAllProducts} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><ChevronDown className={`h-4 w-4 transition-transform ${allProductsExpanded ? "rotate-180" : ""}`} />{allProductsExpanded ? label("收合全部品項") : label("展開全部品項")}</button>
            <button
              type="button"
              disabled={!aiTranslationConfigured || translationOptions.length === 0 || busy || aiTranslating}
              title={aiTranslationConfigured ? label("只補齊已啟用語系的缺漏內容") : label("AI 翻譯尚未完成伺服器設定")}
              onClick={() => void translateMissingContent()}
              className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold text-teal-800 disabled:cursor-not-allowed disabled:opacity-45"
            >
              <Sparkles className="h-4 w-4" />
              {aiTranslating ? label("翻譯中…") : label("一鍵補齊翻譯")}
            </button>
            <a href={`/api/merchant/organizations/${organizationId}/catalog/export`} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Download className="h-4 w-4" />{label("匯出 CSV")}</a>
            <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Upload className="h-4 w-4" />{label("匯入 CSV")}<input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewCatalogImport(file); event.currentTarget.value = ""; }} /></label>
          </div>
          <div data-testid="shared-catalog-create-actions" className="flex flex-wrap gap-2 lg:justify-end">
            <button type="button" onClick={createCategory} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Plus className="h-4 w-4" />{label("分類")}</button>
            <button type="button" disabled={sortedCategories.length === 0} onClick={createGroup} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />{label("群組")}</button>
            <button type="button" onClick={() => createProduct("SINGLE")} className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white"><Plus className="h-4 w-4" />{label("商品")}</button>
            <button type="button" onClick={() => createProduct("BUNDLE")} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-teal-700 bg-teal-50 px-3 text-sm font-semibold text-teal-900"><PackageOpen className="h-4 w-4" />{label("新增套餐")}</button>
          </div>
        </div>
      </div>

      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      <details id="shared-product-catalog" open={catalogOpen} onToggle={(event) => setCatalogOpen(event.currentTarget.open)} data-shared-product-catalog className="group mt-5">
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 border-y border-stone-200 py-3 font-semibold hover:text-teal-800 [&::-webkit-details-marker]:hidden">
          <span>{label("商品目錄（")}{catalog.products.length}）</span>
          <ChevronDown className="h-5 w-5 shrink-0 transition-transform group-open:rotate-180" />
        </summary>
        <div className="divide-y divide-stone-200 border-b border-stone-200">
          {sortedCategories.map((category) => {
            const groups = catalog.groups.filter((group) => group.categoryId === category.id);
            const ungrouped = productsFor(category.id, null);
            return (
              <details key={category.id} open={!collapsedCategoryIds.has(category.id)} onToggle={(event) => {
                const isOpen = event.currentTarget.open;
                setCollapsedCategoryIds((current) => {
                  const next = new Set(current);
                  if (isOpen) next.delete(category.id);
                  else next.add(category.id);
                  return next;
                });
              }} className="group py-1">
                <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
                  <Boxes className="h-4 w-4 text-teal-700" />
                  <span className="font-semibold">{category.name}</span>
                  {!category.isActive ? <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">{label("已停用")}</span> : null}
                  <span className="ml-auto text-xs text-stone-500">{catalog.products.filter((product) => product.categoryId === category.id).length} {label("項")}</span>
                  <IconButton label={m("編輯 {value0}", { value0: category.name })} onClick={(event) => { event.preventDefault(); editCategory(category); }}><Pencil className="h-4 w-4" /></IconButton>
                  <IconButton label={`${category.isActive ? label("停用") : label("恢復")} ${category.name}`} onClick={(event) => { event.preventDefault(); void toggleActive("CATEGORY", category); }}>{category.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                </summary>
                <div className="pb-4 pl-3 sm:pl-6">
                  {groups.map((group) => (
                    <div key={group.id} className="border-l-2 border-stone-200 py-3 pl-4">
                      <div className="flex items-center gap-2">
                        <h2 className="text-sm font-semibold">{group.name}</h2>
                        {!group.isActive ? <span className="text-xs text-stone-500">{label("已停用")}</span> : null}
                        <span className="ml-auto text-xs text-stone-500">{productsFor(category.id, group.id).length} {label("項")}</span>
                        <IconButton label={m("編輯 {value0}", { value0: group.name })} onClick={() => editGroup(group)}><Pencil className="h-4 w-4" /></IconButton>
                        <IconButton label={`${group.isActive ? label("停用") : label("恢復")} ${group.name}`} onClick={() => void toggleActive("GROUP", group)}>{group.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                      </div>
                      <ProductRows products={productsFor(category.id, group.id)} currency={currency} onEdit={editProduct} onBundle={openBundle} onAssignments={openAssignments} onClone={(product) => void cloneProduct(product)} onToggle={(product) => void toggleActive("PRODUCT", product)} onDelete={(product) => void deleteProduct(product)} />
                    </div>
                  ))}
                  {ungrouped.length > 0 ? (
                    <div className="border-l-2 border-stone-200 py-3 pl-4">
                      <h2 className="text-sm font-semibold">{label("未分組商品")}</h2>
                      <ProductRows products={ungrouped} currency={currency} onEdit={editProduct} onBundle={openBundle} onAssignments={openAssignments} onClone={(product) => void cloneProduct(product)} onToggle={(product) => void toggleActive("PRODUCT", product)} onDelete={(product) => void deleteProduct(product)} />
                    </div>
                  ) : null}
                </div>
              </details>
            );
          })}
          {sortedCategories.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{label("尚未建立商品分類。")}</p> : null}
        </div>
      </details>

      {categoryDraft ? (
        <Editor
          title={categoryDraft.id ? label("編輯分類") : label("新增分類")}
          onClose={() => { clearEditorFeedback(); setCategoryDraft(null); }}
          dialogRef={editorRef}
          errorMessage={editorMessage}
        >
          <form noValidate onSubmit={saveCategory} className="grid gap-4">
            <TextField label={label("分類名稱")} fieldKey="name" error={editorFieldErrors.name} value={categoryDraft.name} onChange={(name) => { clearEditorField("name"); setCategoryDraft({ ...categoryDraft, name }); }} />
            <NumberField label={label("排序")} fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={categoryDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setCategoryDraft({ ...categoryDraft, sortOrder }); }} />
            {categoryDraft.id ? <CheckField label={label("啟用分類")} checked={categoryDraft.isActive} onChange={(isActive) => setCategoryDraft({ ...categoryDraft, isActive })} /> : null}
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {groupDraft ? (
        <Editor
          title={groupDraft.id ? label("編輯群組") : label("新增群組")}
          onClose={() => { clearEditorFeedback(); setGroupDraft(null); }}
          dialogRef={editorRef}
          errorMessage={editorMessage}
        >
          <form noValidate onSubmit={saveGroup} className="grid gap-4">
            <SelectField label={label("所屬分類")} fieldKey="categoryId" error={editorFieldErrors.categoryId} value={groupDraft.categoryId} options={sortedCategories.map((category) => ({ value: category.id, label: category.name }))} onChange={(categoryId) => { clearEditorField("categoryId"); setGroupDraft({ ...groupDraft, categoryId }); }} />
            <TextField label={label("群組名稱")} fieldKey="name" error={editorFieldErrors.name} value={groupDraft.name} onChange={(name) => { clearEditorField("name"); setGroupDraft({ ...groupDraft, name }); }} />
            <NumberField label={label("排序")} fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={groupDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setGroupDraft({ ...groupDraft, sortOrder }); }} />
            {groupDraft.id ? <CheckField label={label("啟用群組")} checked={groupDraft.isActive} onChange={(isActive) => setGroupDraft({ ...groupDraft, isActive })} /> : null}
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {productDraft ? (
        <Editor title={productDraft.id ? label("編輯商品") : productDraft.kind === "BUNDLE" ? label("新增套餐") : label("新增商品")} onClose={() => { clearEditorFeedback(); setProductDraft(null); }} dialogRef={editorRef} errorMessage={editorMessage} wide>
          <form noValidate onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2">
            <TextField label={label("商品名稱")} fieldKey="name" error={editorFieldErrors.name} value={productDraft.name} onChange={(name) => { clearEditorField("name"); setProductDraft({ ...productDraft, name }); }} wide />
            <SelectField label={label("分類")} fieldKey="categoryId" error={editorFieldErrors.categoryId} value={productDraft.categoryId} options={sortedCategories.map((category) => ({ value: category.id, label: category.name }))} onChange={(categoryId) => { clearEditorField("categoryId"); clearEditorField("groupId"); setProductDraft({ ...productDraft, categoryId, groupId: null }); }} />
            <SelectField label={label("群組")} fieldKey="groupId" error={editorFieldErrors.groupId} required={false} value={productDraft.groupId ?? ""} options={[{ value: "", label: label("不分組") }, ...catalog.groups.filter((group) => group.categoryId === productDraft.categoryId).map((group) => ({ value: group.id, label: group.name }))]} onChange={(groupId) => { clearEditorField("groupId"); setProductDraft({ ...productDraft, groupId: groupId || null }); }} />
            <SelectField label={label("商品類型")} value={productDraft.kind} options={[{ value: "SINGLE", label: label("一般商品") }, { value: "BUNDLE", label: label("套餐") }]} onChange={(kind) => setProductDraft({ ...productDraft, kind: kind as ProductKindValue })} />
            <PriceField label={productDraft.kind === "BUNDLE" ? label("套餐組合價") : label("預設售價")} fieldKey="defaultPrice" error={editorFieldErrors.defaultPrice} value={productDraft.defaultPrice} onChange={(defaultPrice) => { clearEditorField("defaultPrice"); setProductDraft({ ...productDraft, defaultPrice }); }} />
            {productDraft.kind === "BUNDLE" ? <p className="text-xs text-stone-600 sm:col-span-2">{label("儲存後請按商品列的「設定套餐內容」，即可把 A、B 等一般商品加入套餐；固定 A＋B 可將群組最少與最多選擇都設為 2。套餐不可加入另一個套餐。")}</p> : null}
            <NumberField label={label("排序")} fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={productDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setProductDraft({ ...productDraft, sortOrder }); }} />
            <label className="text-sm font-medium text-stone-700 sm:col-span-2">{label("商品描述")}<textarea maxLength={500} rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[1fr_auto]">
              <TextField label={label("圖片網址")} fieldKey="imageUrl" error={editorFieldErrors.imageUrl} type="url" maxLength={2000} value={productDraft.imageUrl ?? ""} required={false} onChange={(imageUrl) => { clearEditorField("imageUrl"); setProductDraft({ ...productDraft, imageUrl: imageUrl || null }); }} />
              <label className="mt-6 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><ImageUp className="h-4 w-4" />{label("本機上傳")}<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadProductImage(file); event.currentTarget.value = ""; }} /></label>
            </div>
            {productDraft.imageUrl ? <div className="h-36 overflow-hidden rounded-md border border-stone-200 sm:col-span-2"><ProductImage src={productDraft.imageUrl} alt={m("{value0}圖片預覽", { value0: productDraft.name || label("商品") })} width={800} height={450} sizes="(max-width: 640px) 100vw, 50vw" className="h-full w-full object-cover" /></div> : null}
            <div className="sm:col-span-2">
              <CheckField label={label("不適用訂單折扣")} checked={!productDraft.isOrderDiscountEligible} onChange={(excluded) => setProductDraft({ ...productDraft, isOrderDiscountEligible: !excluded })} />
              <p className="mt-1 text-xs text-stone-500">{label("勾選後，員工結帳折扣與 QR 抽抽樂折扣都不會套用此商品。套餐以套餐商品本身的設定為準。")}</p>
            </div>
            <div className="sm:col-span-2">
              {productDraft.kind === "SINGLE" ? (
                <>
                  <CheckField label={label("參與抽抽樂推薦")} checked={productDraft.isLotteryEligible} onChange={(isLotteryEligible) => setProductDraft({ ...productDraft, isLotteryEligible })} />
                  <p className="mt-1 text-xs text-stone-500">{label("預設啟用；取消勾選後，抽抽樂不會推薦此商品。")}</p>
                </>
              ) : (
                <p className="rounded-md bg-stone-50 px-3 py-2 text-xs text-stone-600">{label("套餐需由客人選擇組合內容，目前不參與抽抽樂推薦。")}</p>
              )}
            </div>
            {translationOptions.length > 0 ? <fieldset className="border-t border-stone-200 pt-4 sm:col-span-2">
              <legend className="flex items-center gap-2 text-sm font-semibold"><Languages className="h-4 w-4" />{label("商品翻譯")}</legend>
              <div className="mt-3 grid gap-4">
                {translationOptions.map((option) => {
                  const translation = productDraft.translations.find((item) => item.locale === option.locale) ?? { locale: option.locale, name: "", description: "" };
                  return <div key={option.locale} className="grid gap-2 sm:grid-cols-2"><TextField label={m("{value0}名稱", { value0: option.label })} value={translation.name} required={false} onChange={(name) => updateTranslation(option.locale, { name })} /><label className="text-sm font-medium text-stone-700">{option.label}{label("說明")}<textarea rows={2} maxLength={500} value={translation.description} onChange={(event) => updateTranslation(option.locale, { description: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label></div>;
                })}
              </div>
            </fieldset> : null}
            {!productDraft.id ? <StallChecks stalls={stalls} selected={productDraft.stallIds} error={editorFieldErrors.stallIds} onChange={(stallIds) => { clearEditorField("stallIds"); setProductDraft({ ...productDraft, stallIds }); }} /> : <CheckField label={label("啟用商品主檔")} checked={productDraft.isActive} onChange={(isActive) => setProductDraft({ ...productDraft, isActive })} />}
            <SubmitButton busy={busy} wide />
          </form>
        </Editor>
      ) : null}

      {importPreview ? (
        <Editor title={label("CSV 匯入預覽")} onClose={() => !busy && setImportPreview(null)} wide>
          <div className="grid grid-cols-3 gap-3 border-y border-stone-200 py-4 text-center"><div><div className="text-2xl font-semibold">{importPreview.totalCount}</div><div className="text-xs text-stone-500">{label("總筆數")}</div></div><div><div className="text-2xl font-semibold text-emerald-700">{importPreview.validCount}</div><div className="text-xs text-stone-500">{label("可套用")}</div></div><div><div className="text-2xl font-semibold text-red-700">{importPreview.invalidCount}</div><div className="text-xs text-stone-500">{label("將略過")}</div></div></div>
          {importPreview.previewRows.length > 0 ? <div className="mt-4 max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-white text-stone-500"><tr><th className="py-2">{label("商品")}</th><th>{label("分類／群組")}</th><th>{label("售價")}</th><th>{label("攤位")}</th></tr></thead><tbody>{importPreview.previewRows.map((row, index) => <tr key={`${row.id ?? "new"}-${index}`} className="border-t border-stone-100"><td className="py-2 font-medium">{row.name}</td><td>{row.category}{row.group ? `／${row.group}` : ""}</td><td>{formatMoney(row.price, currency)}</td><td>{row.stallCodes.join("、") || label("未分派")}</td></tr>)}</tbody></table>{importPreview.validCount > importPreview.previewRows.length ? <p className="py-2 text-xs text-stone-500">{label("僅顯示前")} {importPreview.previewRows.length} {label("筆有效資料。")}</p> : null}</div> : <p className="mt-4 text-sm text-red-700">{label("此檔案沒有可套用的商品資料。")}</p>}
          {importPreview.errors.length > 0 ? <div className="mt-4 border-t border-stone-200 pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">{label("錯誤資料")}</h3><button type="button" onClick={downloadImportErrors} className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold"><Download className="h-4 w-4" />{label("下載錯誤 CSV")}</button></div><ul className="mt-2 max-h-28 overflow-auto text-xs text-red-700">{importPreview.errors.slice(0, 10).map((error) => <li key={`${error.line}-${error.error}`} className="py-1">{error.error}</li>)}</ul></div> : null}
          <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" disabled={busy} onClick={() => setImportPreview(null)} className="h-11 rounded-md border border-stone-300 text-sm font-semibold">{label("取消")}</button><button type="button" disabled={busy || importPreview.validCount === 0} onClick={() => void applyCatalogImport()} className="h-11 rounded-md bg-stone-900 text-sm font-semibold text-white disabled:opacity-40">{busy ? label("套用中…") : m("套用 {value0} 筆有效資料", { value0: importPreview.validCount })}</button></div>
        </Editor>
      ) : null}

      {assignmentProduct ? <Editor title={m("分派「{value0}」", { value0: assignmentProduct.name })} onClose={() => { clearEditorFeedback(); setAssignmentProduct(null); }} dialogRef={editorRef} errorMessage={editorMessage}><StallChecks stalls={stalls} selected={assignmentStallIds} error={editorFieldErrors.stallIds} onChange={(stallIds) => { clearEditorField("stallIds"); setAssignmentStallIds(stallIds); }} /><button type="button" disabled={busy} onClick={() => void saveAssignments()} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />{label("儲存分派")}</button></Editor> : null}
      {bundleProduct ? (
        <Editor
          title={m("設定「{value0}」套餐內容", { value0: bundleProduct.name })}
          onClose={() => {
            clearBundleFeedback();
            setBundleProductId(null);
            setBundleChoiceGroupDraft(null);
            setBundleChoiceDraft(null);
          }}
          dialogRef={bundleEditorRef}
          errorMessage={bundleMessage}
          wide
        >
          <div className="max-h-[75vh] overflow-y-auto pr-1">
            <div className="rounded-md bg-teal-50 p-3 text-sm text-teal-950">
              <p className="font-semibold">{label("套餐組合價：")}{formatMoney(bundleProduct.defaultPrice, currency)}</p>
              <p className="mt-1 text-xs">{label("每個群組設定客人最少與最多可選數量；選項價差會加在套餐組合價上。套餐只能加入一般商品。")}</p>
            </div>
            <section
              role="region"
              aria-label={label("套餐顯示狀態")}
              data-testid="bundle-visibility-summary"
              className="mt-3 rounded-md border border-stone-200 bg-stone-50 p-3"
            >
              <h3 className="text-sm font-semibold text-stone-900">{label("QR／店員點餐顯示檢查")}</h3>
              {bundleProduct.stallProducts.length === 0 ? (
                <p className="mt-2 rounded-md bg-red-50 px-3 py-2 text-sm font-medium text-red-800">
                  {label("尚未分派任何攤位：套餐不會顯示。請回到商品列設定分派；系統不會自動變更元件商品分派。")}
                </p>
              ) : (
                <ul className="mt-2 space-y-2">
                  {bundleStallVisibility.map((status) => (
                    <li
                      key={status.stallId}
                      data-testid={`bundle-stall-visibility-${status.stallId}`}
                      className={`rounded-md px-3 py-2 text-sm ${status.visible ? "bg-emerald-50 text-emerald-900" : "bg-red-50 text-red-900"}`}
                    >
                      <span className="font-semibold">{status.stallName}：</span>
                      {status.visible ? label("可顯示") : m("套餐不會顯示（{value0}）", { value0: status.reasons.join("；") })}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-stone-500">{label("依目前商品啟用、攤位分派、分派啟用與售罄狀態判斷；實際顯示仍受營業及販售時段影響。")}</p>
            </section>
            <div className="mt-4 flex items-center justify-between gap-3">
              <h3 className="font-semibold">{label("選擇群組")}</h3>
              <button
                type="button"
                disabled={busy}
                onClick={() => {
                  clearBundleFeedback();
                  setBundleChoiceDraft(null);
                  setBundleChoiceGroupDraft({
                    bundleProductId: bundleProduct.id,
                    name: "",
                    minSelections: 1,
                    maxSelections: 1,
                    sortOrder: bundleProduct.bundleChoiceGroups.length + 1,
                  });
                }}
                className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"
              >
                <Plus className="h-4 w-4" />{label("新增群組")}
              </button>
            </div>

            {bundleChoiceGroupDraft ? (
              <form noValidate onSubmit={saveBundleChoiceGroup} className="mt-3 grid gap-3 rounded-md border border-teal-200 bg-teal-50/40 p-4 sm:grid-cols-2">
                <TextField label={label("群組名稱")} fieldKey="name" error={bundleFieldErrors.name} value={bundleChoiceGroupDraft.name} onChange={(name) => { clearBundleField("name"); setBundleChoiceGroupDraft({ ...bundleChoiceGroupDraft, name }); }} wide />
                <NumberField label={label("最少選擇")} fieldKey="minSelections" error={bundleFieldErrors.minSelections} value={bundleChoiceGroupDraft.minSelections} min={0} max={20} onChange={(minSelections) => { clearBundleField("minSelections"); setBundleChoiceGroupDraft({ ...bundleChoiceGroupDraft, minSelections }); }} />
                <NumberField label={label("最多選擇")} fieldKey="maxSelections" error={bundleFieldErrors.maxSelections} value={bundleChoiceGroupDraft.maxSelections} min={1} max={20} onChange={(maxSelections) => { clearBundleField("maxSelections"); setBundleChoiceGroupDraft({ ...bundleChoiceGroupDraft, maxSelections }); }} />
                <NumberField label={label("排序")} fieldKey="sortOrder" error={bundleFieldErrors.sortOrder} value={bundleChoiceGroupDraft.sortOrder} max={10_000} onChange={(sortOrder) => { clearBundleField("sortOrder"); setBundleChoiceGroupDraft({ ...bundleChoiceGroupDraft, sortOrder }); }} />
                <div className="flex items-end gap-2">
                  <button type="button" disabled={busy} onClick={() => { clearBundleFeedback(); setBundleChoiceGroupDraft(null); }} className="min-h-10 flex-1 rounded-md border border-stone-300 px-3 text-sm font-semibold">{label("取消")}</button>
                  <SubmitButton busy={busy} />
                </div>
              </form>
            ) : null}

            <div className="mt-4 grid gap-4">
              {bundleProduct.bundleChoiceGroups.map((choiceGroup) => (
                <section key={choiceGroup.id} className="overflow-hidden rounded-lg border border-teal-200 bg-white shadow-sm">
                  <div className="flex flex-wrap items-center gap-2 border-b border-teal-200 bg-teal-50 px-4 py-3">
                    <div>
                      <span className="inline-flex rounded-full bg-teal-700 px-2 py-0.5 text-[11px] font-semibold text-white">{label("套餐群組")}</span>
                      <h4 className="mt-1 font-bold text-teal-950">{choiceGroup.name}</h4>
                      <p className="text-xs text-teal-800">{label("選")} {choiceGroup.minSelections}～{choiceGroup.maxSelections} {label("項")}</p>
                    </div>
                    <div className="ml-auto flex items-center">
                      <IconButton label={m("編輯 {value0}", { value0: choiceGroup.name })} onClick={() => editBundleChoiceGroup(choiceGroup)}><Pencil className="h-4 w-4" /></IconButton>
                      <IconButton label={m("刪除 {value0}", { value0: choiceGroup.name })} danger onClick={() => void deleteBundleChoiceGroup(choiceGroup)}><Trash2 className="h-4 w-4" /></IconButton>
                    </div>
                  </div>

                  <div className="mx-4 mt-3 divide-y divide-stone-100 border-y border-stone-100">
                    {choiceGroup.choices.map((choice) => {
                      const componentProduct = singleProducts.find((product) => product.id === choice.componentProductId);
                      const componentIssues = getBundleComponentIssues(
                        bundleProduct,
                        componentProduct,
                        stalls,
                        catalog.categories,
                        label,
                      );
                      return (
                        <div key={choice.id} className="flex min-h-12 items-center gap-2 py-2 text-sm">
                          <div className="min-w-0">
                            <p className="truncate font-medium">{choice.componentProduct.name} × {choice.quantity}</p>
                            <p className="text-xs text-stone-500">{choice.priceDelta === 0 ? label("無價差") : `${choice.priceDelta > 0 ? "+" : ""}${formatMoney(choice.priceDelta, currency)}`}{!choice.isEnabled ? label(" · 已停用") : ""}</p>
                            {componentIssues.length > 0 ? (
                              <p data-testid={`bundle-choice-availability-${choice.id}`} className="mt-1 text-xs font-medium text-red-700">
                                {label("不可用元件：")}{componentIssues.map((issue) => `${issue.stallName}－${issue.reason}`).join("；")}
                              </p>
                            ) : null}
                          </div>
                          <div className="ml-auto flex items-center">
                            <IconButton label={m("編輯 {value0}", { value0: choice.componentProduct.name })} onClick={() => editBundleChoice(choice)}><Pencil className="h-4 w-4" /></IconButton>
                            <IconButton label={m("移除 {value0}", { value0: choice.componentProduct.name })} danger onClick={() => void deleteBundleChoice(choice)}><Trash2 className="h-4 w-4" /></IconButton>
                          </div>
                        </div>
                      );
                    })}
                    {choiceGroup.choices.length === 0 ? <p className="py-3 text-sm text-stone-500">{label("尚未加入一般商品。")}</p> : null}
                  </div>

                  {bundleChoiceDraft?.choiceGroupId === choiceGroup.id ? (
                    <form noValidate onSubmit={saveBundleChoice} className="mx-4 mb-4 mt-3 grid gap-3 rounded-md bg-stone-50 p-3 sm:grid-cols-2">
                      <SelectField label={label("一般商品")} fieldKey="componentProductId" error={bundleFieldErrors.componentProductId} value={bundleChoiceDraft.componentProductId} options={singleProducts.map((product) => ({
                        value: product.id,
                        label: bundleComponentOptionLabel(
                          product,
                          getBundleComponentIssues(bundleProduct, product, stalls, catalog.categories, label),
                          bundleProduct.stallProducts.length,
                          m,
                        ),
                      }))} onChange={(componentProductId) => { clearBundleField("componentProductId"); setBundleChoiceDraft({ ...bundleChoiceDraft, componentProductId }); }} />
                      <p
                        role="status"
                        data-testid="bundle-component-draft-status"
                        className={`rounded-md px-3 py-2 text-xs font-medium sm:col-span-2 ${bundleProduct.stallProducts.length === 0 || selectedBundleComponentIssues.length > 0 ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`}
                      >
                        {bundleProduct.stallProducts.length === 0
                          ? label("套餐尚未分派攤位；儲存此元件後仍不會出現在 QR 或店員點餐。")
                          : selectedBundleComponentIssues.length > 0
                            ? m("此元件不可用：{value0}。若群組可用商品不足，套餐不會顯示。", { value0: selectedBundleComponentIssues.map((issue) => `${issue.stallName}－${issue.reason}`).join("；") })
                            : label("此元件可用於所有套餐分派攤位。")}
                      </p>
                      <NumberField label={label("數量")} fieldKey="quantity" error={bundleFieldErrors.quantity} value={bundleChoiceDraft.quantity} min={1} max={99} onChange={(quantity) => { clearBundleField("quantity"); setBundleChoiceDraft({ ...bundleChoiceDraft, quantity }); }} />
                      <PriceField label={label("價差")} fieldKey="priceDelta" error={bundleFieldErrors.priceDelta} value={bundleChoiceDraft.priceDelta} min={-10_000_000} onChange={(priceDelta) => { clearBundleField("priceDelta"); setBundleChoiceDraft({ ...bundleChoiceDraft, priceDelta }); }} />
                      <NumberField label={label("排序")} fieldKey="sortOrder" error={bundleFieldErrors.sortOrder} value={bundleChoiceDraft.sortOrder} max={10_000} onChange={(sortOrder) => { clearBundleField("sortOrder"); setBundleChoiceDraft({ ...bundleChoiceDraft, sortOrder }); }} />
                      <CheckField label={label("啟用選項")} checked={bundleChoiceDraft.isEnabled} onChange={(isEnabled) => setBundleChoiceDraft({ ...bundleChoiceDraft, isEnabled })} />
                      <div className="flex items-end gap-2">
                        <button type="button" disabled={busy} onClick={() => { clearBundleFeedback(); setBundleChoiceDraft(null); }} className="min-h-10 flex-1 rounded-md border border-stone-300 px-3 text-sm font-semibold">{label("取消")}</button>
                        <SubmitButton busy={busy} />
                      </div>
                    </form>
                  ) : (
                    <button type="button" disabled={busy || singleProducts.length === 0} onClick={() => createBundleChoice(choiceGroup.id)} className="mx-4 mb-4 mt-3 inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"><Plus className="h-4 w-4" />{label("加入一般商品")}</button>
                  )}
                </section>
              ))}
              {bundleProduct.bundleChoiceGroups.length === 0 ? <p className="rounded-md border border-dashed border-stone-300 py-8 text-center text-sm text-stone-500">{label("尚未設定套餐選擇群組。")}</p> : null}
            </div>
          </div>
        </Editor>
      ) : null}
      <ProductNoteGroupsManager
        key={noteGroupsRevision}
        organizationId={organizationId}
        currency={currency}
        products={catalog.products.map((product) => ({
          id: product.id,
          name: product.name,
          categoryName: catalog.categories.find((category) => category.id === product.categoryId)?.name ?? label("未分類"),
          isActive: product.isActive,
        }))}
        initialNoteGroups={noteGroups}
        initialReusableNotes={reusableNotes}
        onChange={(nextNoteGroups, nextReusableNotes) => {
          setNoteGroups(nextNoteGroups);
          setReusableNotes(nextReusableNotes);
        }}
        enabledTranslationLocales={enabledTranslationLocales}
      />
    </section>
  );
}

function ProductRows({ products, currency, onEdit, onBundle, onAssignments, onClone, onToggle, onDelete }: { products: Product[]; currency: string; onEdit: (product: Product) => void; onBundle: (product: Product) => void; onAssignments: (product: Product) => void; onClone: (product: Product) => void; onToggle: (product: Product) => void; onDelete: (product: Product) => void }) {
  const { locale, m, label } = useMerchantMessages();
  const localizedMoney = (amount: number, selectedCurrency = currency) => formatRawMoney(amount, selectedCurrency, locale);
  return <div className="mt-2 divide-y divide-stone-100">{products.map((product) => (
    <div key={product.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{product.name}</span>
          {product.kind === "BUNDLE" ? <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">{label("套餐")}</span> : null}
          {!product.isOrderDiscountEligible ? <span className="rounded bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-800">{label("不適用訂單折扣")}</span> : null}
          {product.kind === "SINGLE" && !product.isLotteryEligible ? <span className="rounded bg-violet-50 px-2 py-0.5 text-xs font-semibold text-violet-800">{label("不參與抽抽樂")}</span> : null}
          {!product.isActive ? <span className="text-xs text-red-700">{label("已停用")}</span> : null}
        </div>
        <p className="mt-1 text-sm text-stone-600">{localizedMoney(product.defaultPrice)} · {label("已分派")} {product.stallProducts.length} {label("攤")}</p>
      </div>
      <div data-testid="shared-product-actions" className="flex min-w-0 flex-wrap items-center gap-1 sm:flex-nowrap sm:justify-end">
        {product.kind === "BUNDLE" ? <button type="button" aria-label={m("設定 {value0} 套餐內容", { value0: product.name })} onClick={() => onBundle(product)} className="mr-auto inline-flex min-h-11 shrink-0 items-center gap-1 rounded-md border border-teal-200 bg-teal-50 px-2 text-xs font-semibold text-teal-900 hover:border-teal-500 sm:mr-0"><PackageOpen className="h-4 w-4" />{label("設定套餐內容")}</button> : null}
        <div className="ml-auto flex items-center">
          <IconButton label={m("分派 {value0}", { value0: product.name })} onClick={() => onAssignments(product)}><Store className="h-4 w-4" /></IconButton>
          <IconButton label={m("複製 {value0}", { value0: product.name })} onClick={() => onClone(product)}><Copy className="h-4 w-4" /></IconButton>
          <IconButton label={m("編輯 {value0}", { value0: product.name })} onClick={() => onEdit(product)}><Pencil className="h-4 w-4" /></IconButton>
          <IconButton label={`${product.isActive ? label("停用") : label("恢復")} ${product.name}`} onClick={() => onToggle(product)}>{product.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
          <IconButton label={m("刪除 {value0}", { value0: product.name })} danger onClick={() => onDelete(product)}><Trash2 className="h-4 w-4" /></IconButton>
        </div>
      </div>
    </div>
  ))}</div>;
}

function StallChecks({ stalls, selected, error, onChange }: { stalls: Stall[]; selected: string[]; error?: string; onChange: (ids: string[]) => void }) {
  const { label } = useMerchantMessages();
  const allSelected = stalls.length > 0 && stalls.every((stall) => selected.includes(stall.id));
  const errorId = "catalog-stallIds-error";
  return <fieldset tabIndex={-1} data-field-key="stallIds" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className={`sm:col-span-2 rounded-md ${error ? "border border-red-500 bg-red-50 p-2" : ""}`}><legend className="text-sm font-medium text-stone-700">{label("分派攤位")}</legend><label className="mt-2 flex min-h-11 items-center gap-2 border-b border-stone-100"><input type="checkbox" checked={allSelected} onChange={(event) => onChange(event.target.checked ? stalls.map((stall) => stall.id) : [])} />{label("全部授權攤位")}</label>{stalls.map((stall) => <label key={stall.id} className="flex min-h-11 items-center gap-2 border-b border-stone-100"><input type="checkbox" checked={selected.includes(stall.id)} onChange={(event) => onChange(event.target.checked ? [...selected, stall.id] : selected.filter((id) => id !== stall.id))} />{stall.name}{!stall.isActive ? <span className="text-xs text-stone-500">{label("（已停用）")}</span> : null}</label>)}{selected.length === 0 ? <p className="mt-2 text-xs font-medium text-amber-800">{label("未分派的商品不會出現在 QR 或店員點餐；單店模式預設會勾選該店。")}</p> : null}{error ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</fieldset>;
}

function Editor({ title, onClose, dialogRef, errorMessage, wide = false, children }: { title: string; onClose: () => void; dialogRef?: React.RefObject<HTMLElement | null>; errorMessage?: string; wide?: boolean; children: React.ReactNode }) {
  const { label } = useMerchantMessages();
  const fallbackDialogRef = useRef<HTMLElement>(null);
  const activeDialogRef = dialogRef ?? fallbackDialogRef;
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = activeDialogRef.current;
    if (!dialog) return;
    const activeDialog: HTMLElement = dialog;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const bodyOverflow = document.body.style.overflow;
    const documentOverflow = document.documentElement.style.overflow;
    const focusableElements = () => [...activeDialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);

    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    (focusableElements()[0] ?? activeDialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusableElements();
      if (elements.length === 0) {
        event.preventDefault();
        activeDialog.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      if (!activeDialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = bodyOverflow;
      document.documentElement.style.overflow = documentOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [activeDialogRef]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-hidden overscroll-contain bg-black/45 p-4">
      <section
        ref={activeDialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-auto flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-lg bg-white shadow-xl ${wide ? "max-w-2xl" : "max-w-md"}`}
      >
        <div data-testid="catalog-editor-header" className="sticky top-0 z-10 flex shrink-0 items-center justify-between gap-3 border-b border-stone-200 bg-white px-5 py-4">
          <h2 className="text-lg font-semibold">{title}</h2>
          <IconButton label={label("關閉")} onClick={onClose}><X className="h-4 w-4" /></IconButton>
        </div>
        <div data-testid="catalog-editor-scroll-region" className="min-h-0 overflow-y-auto overscroll-contain p-5">
          {errorMessage ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</p> : null}
          {children}
        </div>
      </section>
    </div>
  );
}

function IconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-stone-100 ${danger ? "text-red-700" : "text-stone-600"}`}>{children}</button>;
}

function TextField({ label, fieldKey, error, value, onChange, wide = false, required = true, type = "text", maxLength = 80 }: { label: string; fieldKey?: string; error?: string; value: string; onChange: (value: string) => void; wide?: boolean; required?: boolean; type?: "text" | "url"; maxLength?: number }) {
  const errorId = fieldKey ? `catalog-${fieldKey}-error` : undefined;
  return <label className={`text-sm font-medium text-stone-700 ${wide ? "sm:col-span-2" : ""}`}>{label}<input aria-label={label} type={type} required={required} maxLength={maxLength} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(event.target.value)} className={`mt-1 w-full rounded-md border px-3 py-2 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`} />{error && errorId ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}

function NumberField({ label, fieldKey, error, value, min = 0, max = 10_000_000, onChange }: { label: string; fieldKey?: string; error?: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  const errorId = fieldKey ? `catalog-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<input aria-label={label} required type="number" min={min} max={max} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(Number(event.target.value))} className={`mt-1 w-full rounded-md border px-3 py-2 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`} />{error && errorId ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}

function PriceField({ label, fieldKey, error, value, min = 0, onChange }: { label: string; fieldKey?: string; error?: string; value: number | ""; min?: number; onChange: (value: number | "") => void }) {
  const errorId = fieldKey ? `catalog-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<input aria-label={label} required type="number" min={min} max={10_000_000} value={value} placeholder="0" data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(event.target.value === "" ? "" : Number(event.target.value))} className={`mt-1 w-full rounded-md border px-3 py-2 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`} />{error && errorId ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}

function SelectField({ label, fieldKey, error, value, options, onChange, required = true }: { label: string; fieldKey?: string; error?: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void; required?: boolean }) {
  const errorId = fieldKey ? `catalog-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<select aria-label={label} required={required} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(event.target.value)} className={`mt-1 w-full rounded-md border bg-white px-3 py-2 ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`}>{options.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}</select>{error && errorId ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-stone-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function SubmitButton({ busy, wide = false }: { busy: boolean; wide?: boolean }) {
  const { label } = useMerchantMessages();
  return <button disabled={busy} type="submit" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 ${wide ? "sm:col-span-2" : ""}`}><Check className="h-4 w-4" />{label("儲存")}</button>;
}
