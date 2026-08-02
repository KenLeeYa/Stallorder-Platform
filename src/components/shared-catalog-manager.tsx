"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
import {
  Boxes,
  Check,
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
import { formatMoney } from "@/lib/money";
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
  const [catalog, setCatalog] = useState(initialCatalog);
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

  const sortedCategories = useMemo(
    () => [...catalog.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-TW")),
    [catalog.categories],
  );

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
        const errorMessage = payload.error ?? "目前無法更新商品主檔。";
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
      const errorMessage = error instanceof Error ? error.message : "網路連線中斷，請稍後再試。";
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
      "將把已啟用商品與註記的繁體中文名稱、說明傳送至 OpenAI，補齊目前啟用語系的缺漏翻譯。既有人工翻譯不會被覆蓋。確定執行？",
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
      if (!response.ok) throw new Error(payload.error ?? "目前無法完成 AI 翻譯。");
      setCatalog(payload.catalog);
      setNoteGroups(payload.noteGroups);
      setReusableNotes(payload.reusableNotes);
      setNoteGroupsRevision((current) => current + 1);
      const translatedFields = Number(payload.summary?.translatedFields ?? 0);
      setMessage(
        translatedFields > 0
          ? `AI 翻譯已完成，共補齊 ${translatedFields} 個缺漏欄位。`
          : "目前啟用的語系皆已完成翻譯。",
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法完成 AI 翻譯。");
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

  function createProduct() {
    clearEditorFeedback();
    const category = sortedCategories.find((item) => item.isActive);
    if (!category) {
      setMessage("請先建立可用的商品分類。");
      setCategoryDraft({ name: "", sortOrder: catalog.categories.length + 1, isActive: true });
      return;
    }
    const group = catalog.groups.find((item) => item.categoryId === category.id && item.isActive);
    setProductDraft({
      categoryId: category.id,
      groupId: group?.id ?? null,
      name: "",
      description: "",
      defaultPrice: "",
      kind: "SINGLE",
      imageUrl: null,
      sortOrder: catalog.products.length + 1,
      isActive: true,
      stallIds: [],
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
      categoryDraft.id ? "分類已更新。" : "分類已新增。",
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
      groupDraft.id ? "群組已更新。" : "群組已新增。",
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
      sortOrder: productDraft.sortOrder,
      translations: productDraft.translations.filter((translation) => translation.name.trim()),
    };
    const ok = await runCommand(
      productDraft.id
        ? { operation: "UPDATE_PRODUCT", productId: productDraft.id, ...data, isActive: productDraft.isActive }
        : { operation: "CREATE_PRODUCT", ...data, stallIds: productDraft.stallIds },
      productDraft.id ? "商品已更新。" : "商品已新增。",
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
      if (!response.ok) throw new Error(payload.error ?? "商品匯入失敗。");
      setImportPreview({ file, ...payload });
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "商品匯入失敗。");
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
      if (!response.ok) throw new Error(payload.error ?? "商品匯入失敗。");
      setCatalog(payload.catalog);
      setImportPreview(null);
      setMessage(`已套用 ${payload.importedCount} 筆商品${payload.skippedCount > 0 ? `，略過 ${payload.skippedCount} 筆錯誤資料` : ""}。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "商品匯入失敗。");
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
      if (!response.ok) throw new Error(payload.error ?? "圖片上傳失敗。");
      setProductDraft((current) => current ? { ...current, imageUrl: payload.imageUrl } : current);
      setMessage("商品圖片已上傳，儲存商品後生效。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "圖片上傳失敗。");
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
    if (!nextActive && !window.confirm(`確定停用「${item.name}」？商品與歷史訂單資料仍會保留。`)) return;
    if (kind === "CATEGORY") {
      await runCommand({ operation: "UPDATE_CATEGORY", categoryId: item.id, name: item.name, sortOrder: item.sortOrder, isActive: nextActive }, nextActive ? "分類已恢復。" : "分類已停用。");
    } else if (kind === "GROUP") {
      const group = item as Group;
      await runCommand({ operation: "UPDATE_GROUP", groupId: group.id, categoryId: group.categoryId, name: group.name, sortOrder: group.sortOrder, isActive: nextActive }, nextActive ? "群組已恢復。" : "群組已停用。");
    } else {
      const product = item as Product;
      await runCommand({ operation: "UPDATE_PRODUCT", productId: product.id, categoryId: product.categoryId, groupId: product.groupId, name: product.name, description: product.description, defaultPrice: product.defaultPrice, kind: product.kind, imageUrl: product.imageUrl, sortOrder: product.sortOrder, isActive: nextActive, translations: product.translations }, nextActive ? "商品已恢復。" : "商品已停用並停止各攤供應。");
    }
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`確定永久刪除「${product.name}」？各攤供應與翻譯會一併移除，歷史訂單仍保留商品快照。`)) return;
    await runCommand(
      { operation: "DELETE_PRODUCT", productId: product.id },
      "商品已刪除，歷史訂單快照已保留。",
    );
  }

  async function cloneProduct(product: Product) {
    await runCommand(
      { operation: "CLONE_PRODUCT", productId: product.id },
      `已建立「${product.name}」副本，翻譯、註記、套餐內容與攤位分派已一併複製。`,
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
      "攤位分派已更新。",
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
      bundleChoiceGroupDraft.id ? "套餐選擇群組已更新。" : "套餐選擇群組已新增。",
      "bundle",
    );
    if (ok) setBundleChoiceGroupDraft(null);
  }

  async function deleteBundleChoiceGroup(choiceGroup: ProductBundleChoiceGroupView) {
    if (!window.confirm(`確定刪除套餐群組「${choiceGroup.name}」？群組內選項會一併移除。`)) return;
    await runCommand(
      { operation: "DELETE_BUNDLE_CHOICE_GROUP", choiceGroupId: choiceGroup.id },
      "套餐選擇群組已刪除。",
      "bundle",
    );
  }

  function createBundleChoice(choiceGroupId: string) {
    clearBundleFeedback();
    const component = singleProducts.find((product) => product.isActive) ?? singleProducts[0];
    const choiceGroup = bundleProduct?.bundleChoiceGroups.find((group) => group.id === choiceGroupId);
    if (!component) {
      setMessage("請先建立一般商品，才能加入套餐選項。");
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
      bundleChoiceDraft.id ? "套餐選項已更新。" : "套餐選項已新增。",
      "bundle",
    );
    if (ok) setBundleChoiceDraft(null);
  }

  async function deleteBundleChoice(choice: ProductBundleChoiceView) {
    if (!window.confirm(`確定移除套餐選項「${choice.componentProduct.name}」？`)) return;
    await runCommand(
      { operation: "DELETE_BUNDLE_CHOICE", choiceId: choice.id },
      "套餐選項已移除。",
      "bundle",
    );
  }

  function productsFor(categoryId: string, groupId: string | null) {
    return catalog.products.filter((product) => product.categoryId === categoryId && product.groupId === groupId);
  }

  return (
    <section aria-labelledby="shared-catalog-heading">
      <div className="flex flex-col gap-4 border-b border-stone-200 pb-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm font-semibold text-teal-800">組織商品主檔</p>
          <h1 id="shared-catalog-heading" className="mt-1 text-3xl font-semibold">共用商品</h1>
          <p className="mt-2 text-sm text-stone-600">一次建立分類、群組與商品，再分派到一個或多個攤位。</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            disabled={!aiTranslationConfigured || translationOptions.length === 0 || busy || aiTranslating}
            title={aiTranslationConfigured ? "只補齊已啟用語系的缺漏內容" : "AI 翻譯尚未完成伺服器設定"}
            onClick={() => void translateMissingContent()}
            className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold text-teal-800 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Sparkles className="h-4 w-4" />
            {aiTranslating ? "翻譯中…" : "一鍵補齊翻譯"}
          </button>
          <a href={`/api/merchant/organizations/${organizationId}/catalog/export`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Download className="h-4 w-4" />匯出 CSV</a>
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Upload className="h-4 w-4" />匯入 CSV<input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void previewCatalogImport(file); event.currentTarget.value = ""; }} /></label>
          <button type="button" onClick={createCategory} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Plus className="h-4 w-4" />分類</button>
          <button type="button" disabled={sortedCategories.length === 0} onClick={createGroup} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />群組</button>
          <button type="button" onClick={createProduct} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white"><Plus className="h-4 w-4" />商品</button>
        </div>
      </div>

      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
        {sortedCategories.map((category) => {
          const groups = catalog.groups.filter((group) => group.categoryId === category.id);
          const ungrouped = productsFor(category.id, null);
          return (
            <details key={category.id} open className="group py-1">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden">
                <Boxes className="h-4 w-4 text-teal-700" />
                <span className="font-semibold">{category.name}</span>
                {!category.isActive ? <span className="rounded-md bg-stone-100 px-2 py-0.5 text-xs text-stone-600">已停用</span> : null}
                <span className="ml-auto text-xs text-stone-500">{catalog.products.filter((product) => product.categoryId === category.id).length} 項</span>
                <IconButton label={`編輯 ${category.name}`} onClick={(event) => { event.preventDefault(); editCategory(category); }}><Pencil className="h-4 w-4" /></IconButton>
                <IconButton label={`${category.isActive ? "停用" : "恢復"} ${category.name}`} onClick={(event) => { event.preventDefault(); void toggleActive("CATEGORY", category); }}>{category.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
              </summary>
              <div className="pb-4 pl-3 sm:pl-6">
                {groups.map((group) => (
                  <div key={group.id} className="border-l-2 border-stone-200 py-3 pl-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{group.name}</h2>
                      {!group.isActive ? <span className="text-xs text-stone-500">已停用</span> : null}
                      <span className="ml-auto text-xs text-stone-500">{productsFor(category.id, group.id).length} 項</span>
                      <IconButton label={`編輯 ${group.name}`} onClick={() => editGroup(group)}><Pencil className="h-4 w-4" /></IconButton>
                      <IconButton label={`${group.isActive ? "停用" : "恢復"} ${group.name}`} onClick={() => void toggleActive("GROUP", group)}>{group.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                    </div>
                    <ProductRows products={productsFor(category.id, group.id)} currency={currency} onEdit={editProduct} onBundle={openBundle} onAssignments={openAssignments} onClone={(product) => void cloneProduct(product)} onToggle={(product) => void toggleActive("PRODUCT", product)} onDelete={(product) => void deleteProduct(product)} />
                  </div>
                ))}
                {ungrouped.length > 0 ? (
                  <div className="border-l-2 border-stone-200 py-3 pl-4">
                    <h2 className="text-sm font-semibold">未分組商品</h2>
                    <ProductRows products={ungrouped} currency={currency} onEdit={editProduct} onBundle={openBundle} onAssignments={openAssignments} onClone={(product) => void cloneProduct(product)} onToggle={(product) => void toggleActive("PRODUCT", product)} onDelete={(product) => void deleteProduct(product)} />
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
        {sortedCategories.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">尚未建立商品分類。</p> : null}
      </div>

      {categoryDraft ? (
        <Editor
          title={categoryDraft.id ? "編輯分類" : "新增分類"}
          onClose={() => { clearEditorFeedback(); setCategoryDraft(null); }}
          dialogRef={editorRef}
          errorMessage={editorMessage}
        >
          <form noValidate onSubmit={saveCategory} className="grid gap-4">
            <TextField label="分類名稱" fieldKey="name" error={editorFieldErrors.name} value={categoryDraft.name} onChange={(name) => { clearEditorField("name"); setCategoryDraft({ ...categoryDraft, name }); }} />
            <NumberField label="排序" fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={categoryDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setCategoryDraft({ ...categoryDraft, sortOrder }); }} />
            {categoryDraft.id ? <CheckField label="啟用分類" checked={categoryDraft.isActive} onChange={(isActive) => setCategoryDraft({ ...categoryDraft, isActive })} /> : null}
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {groupDraft ? (
        <Editor
          title={groupDraft.id ? "編輯群組" : "新增群組"}
          onClose={() => { clearEditorFeedback(); setGroupDraft(null); }}
          dialogRef={editorRef}
          errorMessage={editorMessage}
        >
          <form noValidate onSubmit={saveGroup} className="grid gap-4">
            <SelectField label="所屬分類" fieldKey="categoryId" error={editorFieldErrors.categoryId} value={groupDraft.categoryId} options={sortedCategories.map((category) => ({ value: category.id, label: category.name }))} onChange={(categoryId) => { clearEditorField("categoryId"); setGroupDraft({ ...groupDraft, categoryId }); }} />
            <TextField label="群組名稱" fieldKey="name" error={editorFieldErrors.name} value={groupDraft.name} onChange={(name) => { clearEditorField("name"); setGroupDraft({ ...groupDraft, name }); }} />
            <NumberField label="排序" fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={groupDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setGroupDraft({ ...groupDraft, sortOrder }); }} />
            {groupDraft.id ? <CheckField label="啟用群組" checked={groupDraft.isActive} onChange={(isActive) => setGroupDraft({ ...groupDraft, isActive })} /> : null}
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {productDraft ? (
        <Editor title={productDraft.id ? "編輯商品" : "新增商品"} onClose={() => { clearEditorFeedback(); setProductDraft(null); }} dialogRef={editorRef} errorMessage={editorMessage} wide>
          <form noValidate onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2">
            <TextField label="商品名稱" fieldKey="name" error={editorFieldErrors.name} value={productDraft.name} onChange={(name) => { clearEditorField("name"); setProductDraft({ ...productDraft, name }); }} wide />
            <SelectField label="分類" fieldKey="categoryId" error={editorFieldErrors.categoryId} value={productDraft.categoryId} options={sortedCategories.map((category) => ({ value: category.id, label: category.name }))} onChange={(categoryId) => { clearEditorField("categoryId"); clearEditorField("groupId"); setProductDraft({ ...productDraft, categoryId, groupId: null }); }} />
            <SelectField label="群組" fieldKey="groupId" error={editorFieldErrors.groupId} required={false} value={productDraft.groupId ?? ""} options={[{ value: "", label: "不分組" }, ...catalog.groups.filter((group) => group.categoryId === productDraft.categoryId).map((group) => ({ value: group.id, label: group.name }))]} onChange={(groupId) => { clearEditorField("groupId"); setProductDraft({ ...productDraft, groupId: groupId || null }); }} />
            <SelectField label="商品類型" value={productDraft.kind} options={[{ value: "SINGLE", label: "一般商品" }, { value: "BUNDLE", label: "套餐" }]} onChange={(kind) => setProductDraft({ ...productDraft, kind: kind as ProductKindValue })} />
            <PriceField label={productDraft.kind === "BUNDLE" ? "套餐組合價" : "預設售價"} fieldKey="defaultPrice" error={editorFieldErrors.defaultPrice} value={productDraft.defaultPrice} onChange={(defaultPrice) => { clearEditorField("defaultPrice"); setProductDraft({ ...productDraft, defaultPrice }); }} />
            {productDraft.kind === "BUNDLE" ? <p className="text-xs text-stone-600 sm:col-span-2">先儲存套餐商品，再從商品列的「設定套餐內容」加入選擇群組與一般商品。套餐不可加入另一個套餐。</p> : null}
            <NumberField label="排序" fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={productDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setProductDraft({ ...productDraft, sortOrder }); }} />
            <label className="text-sm font-medium text-stone-700 sm:col-span-2">商品描述<textarea maxLength={500} rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[1fr_auto]">
              <TextField label="圖片網址" fieldKey="imageUrl" error={editorFieldErrors.imageUrl} type="url" maxLength={2000} value={productDraft.imageUrl ?? ""} required={false} onChange={(imageUrl) => { clearEditorField("imageUrl"); setProductDraft({ ...productDraft, imageUrl: imageUrl || null }); }} />
              <label className="mt-6 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><ImageUp className="h-4 w-4" />本機上傳<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadProductImage(file); event.currentTarget.value = ""; }} /></label>
            </div>
            {productDraft.imageUrl ? <div className="h-36 overflow-hidden rounded-md border border-stone-200 sm:col-span-2"><ProductImage src={productDraft.imageUrl} alt={`${productDraft.name || "商品"}圖片預覽`} width={800} height={450} sizes="(max-width: 640px) 100vw, 50vw" className="h-full w-full object-cover" /></div> : null}
            {translationOptions.length > 0 ? <fieldset className="border-t border-stone-200 pt-4 sm:col-span-2">
              <legend className="flex items-center gap-2 text-sm font-semibold"><Languages className="h-4 w-4" />商品翻譯</legend>
              <div className="mt-3 grid gap-4">
                {translationOptions.map((option) => {
                  const translation = productDraft.translations.find((item) => item.locale === option.locale) ?? { locale: option.locale, name: "", description: "" };
                  return <div key={option.locale} className="grid gap-2 sm:grid-cols-2"><TextField label={`${option.label}名稱`} value={translation.name} required={false} onChange={(name) => updateTranslation(option.locale, { name })} /><label className="text-sm font-medium text-stone-700">{option.label}說明<textarea rows={2} maxLength={500} value={translation.description} onChange={(event) => updateTranslation(option.locale, { description: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label></div>;
                })}
              </div>
            </fieldset> : null}
            {!productDraft.id ? <StallChecks stalls={stalls} selected={productDraft.stallIds} error={editorFieldErrors.stallIds} onChange={(stallIds) => { clearEditorField("stallIds"); setProductDraft({ ...productDraft, stallIds }); }} /> : <CheckField label="啟用商品主檔" checked={productDraft.isActive} onChange={(isActive) => setProductDraft({ ...productDraft, isActive })} />}
            <SubmitButton busy={busy} wide />
          </form>
        </Editor>
      ) : null}

      {importPreview ? (
        <Editor title="CSV 匯入預覽" onClose={() => !busy && setImportPreview(null)} wide>
          <div className="grid grid-cols-3 gap-3 border-y border-stone-200 py-4 text-center"><div><div className="text-2xl font-semibold">{importPreview.totalCount}</div><div className="text-xs text-stone-500">總筆數</div></div><div><div className="text-2xl font-semibold text-emerald-700">{importPreview.validCount}</div><div className="text-xs text-stone-500">可套用</div></div><div><div className="text-2xl font-semibold text-red-700">{importPreview.invalidCount}</div><div className="text-xs text-stone-500">將略過</div></div></div>
          {importPreview.previewRows.length > 0 ? <div className="mt-4 max-h-64 overflow-auto"><table className="w-full text-left text-xs"><thead className="sticky top-0 bg-white text-stone-500"><tr><th className="py-2">商品</th><th>分類／群組</th><th>售價</th><th>攤位</th></tr></thead><tbody>{importPreview.previewRows.map((row, index) => <tr key={`${row.id ?? "new"}-${index}`} className="border-t border-stone-100"><td className="py-2 font-medium">{row.name}</td><td>{row.category}{row.group ? `／${row.group}` : ""}</td><td>{formatMoney(row.price, currency)}</td><td>{row.stallCodes.join("、") || "未分派"}</td></tr>)}</tbody></table>{importPreview.validCount > importPreview.previewRows.length ? <p className="py-2 text-xs text-stone-500">僅顯示前 {importPreview.previewRows.length} 筆有效資料。</p> : null}</div> : <p className="mt-4 text-sm text-red-700">此檔案沒有可套用的商品資料。</p>}
          {importPreview.errors.length > 0 ? <div className="mt-4 border-t border-stone-200 pt-4"><div className="flex items-center justify-between gap-3"><h3 className="text-sm font-semibold">錯誤資料</h3><button type="button" onClick={downloadImportErrors} className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold"><Download className="h-4 w-4" />下載錯誤 CSV</button></div><ul className="mt-2 max-h-28 overflow-auto text-xs text-red-700">{importPreview.errors.slice(0, 10).map((error) => <li key={`${error.line}-${error.error}`} className="py-1">{error.error}</li>)}</ul></div> : null}
          <div className="mt-5 grid grid-cols-2 gap-3"><button type="button" disabled={busy} onClick={() => setImportPreview(null)} className="h-11 rounded-md border border-stone-300 text-sm font-semibold">取消</button><button type="button" disabled={busy || importPreview.validCount === 0} onClick={() => void applyCatalogImport()} className="h-11 rounded-md bg-stone-900 text-sm font-semibold text-white disabled:opacity-40">{busy ? "套用中…" : `套用 ${importPreview.validCount} 筆有效資料`}</button></div>
        </Editor>
      ) : null}

      {assignmentProduct ? <Editor title={`分派「${assignmentProduct.name}」`} onClose={() => { clearEditorFeedback(); setAssignmentProduct(null); }} dialogRef={editorRef} errorMessage={editorMessage}><StallChecks stalls={stalls} selected={assignmentStallIds} error={editorFieldErrors.stallIds} onChange={(stallIds) => { clearEditorField("stallIds"); setAssignmentStallIds(stallIds); }} /><button type="button" disabled={busy} onClick={() => void saveAssignments()} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存分派</button></Editor> : null}
      {bundleProduct ? (
        <Editor
          title={`設定「${bundleProduct.name}」套餐內容`}
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
              <p className="font-semibold">套餐組合價：{formatMoney(bundleProduct.defaultPrice, currency)}</p>
              <p className="mt-1 text-xs">每個群組設定客人最少與最多可選數量；選項價差會加在套餐組合價上。套餐只能加入一般商品。</p>
            </div>
            <div className="mt-4 flex items-center justify-between gap-3">
              <h3 className="font-semibold">選擇群組</h3>
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
                <Plus className="h-4 w-4" />新增群組
              </button>
            </div>

            {bundleChoiceGroupDraft ? (
              <form noValidate onSubmit={saveBundleChoiceGroup} className="mt-3 grid gap-3 rounded-md border border-teal-200 bg-teal-50/40 p-4 sm:grid-cols-2">
                <TextField label="群組名稱" fieldKey="name" error={bundleFieldErrors.name} value={bundleChoiceGroupDraft.name} onChange={(name) => { clearBundleField("name"); setBundleChoiceGroupDraft({ ...bundleChoiceGroupDraft, name }); }} wide />
                <NumberField label="最少選擇" fieldKey="minSelections" error={bundleFieldErrors.minSelections} value={bundleChoiceGroupDraft.minSelections} min={0} max={20} onChange={(minSelections) => { clearBundleField("minSelections"); setBundleChoiceGroupDraft({ ...bundleChoiceGroupDraft, minSelections }); }} />
                <NumberField label="最多選擇" fieldKey="maxSelections" error={bundleFieldErrors.maxSelections} value={bundleChoiceGroupDraft.maxSelections} min={1} max={20} onChange={(maxSelections) => { clearBundleField("maxSelections"); setBundleChoiceGroupDraft({ ...bundleChoiceGroupDraft, maxSelections }); }} />
                <NumberField label="排序" fieldKey="sortOrder" error={bundleFieldErrors.sortOrder} value={bundleChoiceGroupDraft.sortOrder} max={10_000} onChange={(sortOrder) => { clearBundleField("sortOrder"); setBundleChoiceGroupDraft({ ...bundleChoiceGroupDraft, sortOrder }); }} />
                <div className="flex items-end gap-2">
                  <button type="button" disabled={busy} onClick={() => { clearBundleFeedback(); setBundleChoiceGroupDraft(null); }} className="min-h-10 flex-1 rounded-md border border-stone-300 px-3 text-sm font-semibold">取消</button>
                  <SubmitButton busy={busy} />
                </div>
              </form>
            ) : null}

            <div className="mt-4 grid gap-4">
              {bundleProduct.bundleChoiceGroups.map((choiceGroup) => (
                <section key={choiceGroup.id} className="rounded-md border border-stone-200 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <div>
                      <h4 className="font-semibold">{choiceGroup.name}</h4>
                      <p className="text-xs text-stone-500">選 {choiceGroup.minSelections}～{choiceGroup.maxSelections} 項</p>
                    </div>
                    <div className="ml-auto flex items-center">
                      <IconButton label={`編輯 ${choiceGroup.name}`} onClick={() => editBundleChoiceGroup(choiceGroup)}><Pencil className="h-4 w-4" /></IconButton>
                      <IconButton label={`刪除 ${choiceGroup.name}`} danger onClick={() => void deleteBundleChoiceGroup(choiceGroup)}><Trash2 className="h-4 w-4" /></IconButton>
                    </div>
                  </div>

                  <div className="mt-3 divide-y divide-stone-100 border-y border-stone-100">
                    {choiceGroup.choices.map((choice) => (
                      <div key={choice.id} className="flex min-h-12 items-center gap-2 py-2 text-sm">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{choice.componentProduct.name} × {choice.quantity}</p>
                          <p className="text-xs text-stone-500">{choice.priceDelta === 0 ? "無價差" : `${choice.priceDelta > 0 ? "+" : ""}${formatMoney(choice.priceDelta, currency)}`}{!choice.isEnabled ? " · 已停用" : ""}</p>
                        </div>
                        <div className="ml-auto flex items-center">
                          <IconButton label={`編輯 ${choice.componentProduct.name}`} onClick={() => editBundleChoice(choice)}><Pencil className="h-4 w-4" /></IconButton>
                          <IconButton label={`移除 ${choice.componentProduct.name}`} danger onClick={() => void deleteBundleChoice(choice)}><Trash2 className="h-4 w-4" /></IconButton>
                        </div>
                      </div>
                    ))}
                    {choiceGroup.choices.length === 0 ? <p className="py-3 text-sm text-stone-500">尚未加入一般商品。</p> : null}
                  </div>

                  {bundleChoiceDraft?.choiceGroupId === choiceGroup.id ? (
                    <form noValidate onSubmit={saveBundleChoice} className="mt-3 grid gap-3 rounded-md bg-stone-50 p-3 sm:grid-cols-2">
                      <SelectField label="一般商品" fieldKey="componentProductId" error={bundleFieldErrors.componentProductId} value={bundleChoiceDraft.componentProductId} options={singleProducts.map((product) => ({ value: product.id, label: `${product.name}${product.isActive ? "" : "（已停用）"}` }))} onChange={(componentProductId) => { clearBundleField("componentProductId"); setBundleChoiceDraft({ ...bundleChoiceDraft, componentProductId }); }} />
                      <NumberField label="數量" fieldKey="quantity" error={bundleFieldErrors.quantity} value={bundleChoiceDraft.quantity} min={1} max={99} onChange={(quantity) => { clearBundleField("quantity"); setBundleChoiceDraft({ ...bundleChoiceDraft, quantity }); }} />
                      <PriceField label="價差" fieldKey="priceDelta" error={bundleFieldErrors.priceDelta} value={bundleChoiceDraft.priceDelta} min={-10_000_000} onChange={(priceDelta) => { clearBundleField("priceDelta"); setBundleChoiceDraft({ ...bundleChoiceDraft, priceDelta }); }} />
                      <NumberField label="排序" fieldKey="sortOrder" error={bundleFieldErrors.sortOrder} value={bundleChoiceDraft.sortOrder} max={10_000} onChange={(sortOrder) => { clearBundleField("sortOrder"); setBundleChoiceDraft({ ...bundleChoiceDraft, sortOrder }); }} />
                      <CheckField label="啟用選項" checked={bundleChoiceDraft.isEnabled} onChange={(isEnabled) => setBundleChoiceDraft({ ...bundleChoiceDraft, isEnabled })} />
                      <div className="flex items-end gap-2">
                        <button type="button" disabled={busy} onClick={() => { clearBundleFeedback(); setBundleChoiceDraft(null); }} className="min-h-10 flex-1 rounded-md border border-stone-300 px-3 text-sm font-semibold">取消</button>
                        <SubmitButton busy={busy} />
                      </div>
                    </form>
                  ) : (
                    <button type="button" disabled={busy || singleProducts.length === 0} onClick={() => createBundleChoice(choiceGroup.id)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"><Plus className="h-4 w-4" />加入一般商品</button>
                  )}
                </section>
              ))}
              {bundleProduct.bundleChoiceGroups.length === 0 ? <p className="rounded-md border border-dashed border-stone-300 py-8 text-center text-sm text-stone-500">尚未設定套餐選擇群組。</p> : null}
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
          categoryName: catalog.categories.find((category) => category.id === product.categoryId)?.name ?? "未分類",
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
  return <div className="mt-2 divide-y divide-stone-100">{products.map((product) => (
    <div key={product.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{product.name}</span>
          {product.kind === "BUNDLE" ? <span className="rounded bg-teal-50 px-2 py-0.5 text-xs font-semibold text-teal-800">套餐</span> : null}
          {!product.isActive ? <span className="text-xs text-red-700">已停用</span> : null}
        </div>
        <p className="mt-1 text-sm text-stone-600">{formatMoney(product.defaultPrice, currency)} · 已分派 {product.stallProducts.length} 攤</p>
      </div>
      <div className="flex items-center">
        {product.kind === "BUNDLE" ? <IconButton label={`設定 ${product.name} 套餐內容`} onClick={() => onBundle(product)}><PackageOpen className="h-4 w-4" /></IconButton> : null}
        <IconButton label={`分派 ${product.name}`} onClick={() => onAssignments(product)}><Store className="h-4 w-4" /></IconButton>
        <IconButton label={`複製 ${product.name}`} onClick={() => onClone(product)}><Copy className="h-4 w-4" /></IconButton>
        <IconButton label={`編輯 ${product.name}`} onClick={() => onEdit(product)}><Pencil className="h-4 w-4" /></IconButton>
        <IconButton label={`${product.isActive ? "停用" : "恢復"} ${product.name}`} onClick={() => onToggle(product)}>{product.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
        <IconButton label={`刪除 ${product.name}`} danger onClick={() => onDelete(product)}><Trash2 className="h-4 w-4" /></IconButton>
      </div>
    </div>
  ))}</div>;
}

function StallChecks({ stalls, selected, error, onChange }: { stalls: Stall[]; selected: string[]; error?: string; onChange: (ids: string[]) => void }) {
  const allSelected = stalls.length > 0 && stalls.every((stall) => selected.includes(stall.id));
  const errorId = "catalog-stallIds-error";
  return <fieldset tabIndex={-1} data-field-key="stallIds" aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className={`sm:col-span-2 rounded-md ${error ? "border border-red-500 bg-red-50 p-2" : ""}`}><legend className="text-sm font-medium text-stone-700">分派攤位</legend><label className="mt-2 flex min-h-10 items-center gap-2 border-b border-stone-100"><input type="checkbox" checked={allSelected} onChange={(event) => onChange(event.target.checked ? stalls.map((stall) => stall.id) : [])} />全部授權攤位</label>{stalls.map((stall) => <label key={stall.id} className="flex min-h-10 items-center gap-2 border-b border-stone-100"><input type="checkbox" checked={selected.includes(stall.id)} onChange={(event) => onChange(event.target.checked ? [...selected, stall.id] : selected.filter((id) => id !== stall.id))} />{stall.name}{!stall.isActive ? <span className="text-xs text-stone-500">（已停用）</span> : null}</label>)}{error ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</fieldset>;
}

function Editor({ title, onClose, dialogRef, errorMessage, wide = false, children }: { title: string; onClose: () => void; dialogRef?: React.RefObject<HTMLElement | null>; errorMessage?: string; wide?: boolean; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4"><section ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className={`my-auto w-full rounded-lg bg-white p-5 shadow-xl ${wide ? "max-w-2xl" : "max-w-md"}`}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><IconButton label="關閉" onClick={onClose}><X className="h-4 w-4" /></IconButton></div>{errorMessage ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</p> : null}{children}</section></div>;
}

function IconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-stone-100 ${danger ? "text-red-700" : "text-stone-600"}`}>{children}</button>;
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
  return <button disabled={busy} type="submit" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 ${wide ? "sm:col-span-2" : ""}`}><Check className="h-4 w-4" />儲存</button>;
}
