"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  Boxes,
  Check,
  Download,
  Eye,
  EyeOff,
  ImageUp,
  Languages,
  Pencil,
  Plus,
  Save,
  Store,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { csrfFormHeaders, csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";
import { ProductNoteGroupsManager, type ProductNoteGroupView } from "@/components/product-note-groups-manager";

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
  imageUrl: string | null;
  sortOrder: number;
  isActive: boolean;
  translations: Array<{ locale: string; name: string; description: string }>;
  stallProducts: Assignment[];
};
type Catalog = { categories: Category[]; groups: Group[]; products: Product[] };
type Stall = { id: string; name: string; isActive: boolean };
type CategoryDraft = Omit<Category, "id"> & { id?: string };
type GroupDraft = Omit<Group, "id"> & { id?: string };
type ProductDraft = Omit<Product, "id" | "stallProducts"> & { id?: string; stallIds: string[] };

const translationOptions = [
  { locale: "en", label: "英文" },
  { locale: "ja", label: "日文" },
  { locale: "ko", label: "韓文" },
  { locale: "vi", label: "越南文" },
  { locale: "th", label: "泰文" },
] as const;

export function SharedCatalogManager({
  organizationId,
  currency,
  stalls,
  initialCatalog,
  initialNoteGroups,
}: {
  organizationId: string;
  currency: string;
  stalls: Stall[];
  initialCatalog: Catalog;
  initialNoteGroups: ProductNoteGroupView[];
}) {
  const [catalog, setCatalog] = useState(initialCatalog);
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft | null>(null);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [productDraft, setProductDraft] = useState<ProductDraft | null>(null);
  const [assignmentProduct, setAssignmentProduct] = useState<Product | null>(null);
  const [assignmentStallIds, setAssignmentStallIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  const sortedCategories = useMemo(
    () => [...catalog.categories].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, "zh-TW")),
    [catalog.categories],
  );

  async function runCommand(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/catalog`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新商品主檔。");
      setCatalog(payload.catalog);
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "網路連線中斷，請稍後再試。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function createProduct() {
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
      defaultPrice: 0,
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
      imageUrl: productDraft.imageUrl || null,
      sortOrder: productDraft.sortOrder,
      translations: productDraft.translations.filter((translation) => translation.name.trim()),
    };
    const ok = await runCommand(
      productDraft.id
        ? { operation: "UPDATE_PRODUCT", productId: productDraft.id, ...data, isActive: productDraft.isActive }
        : { operation: "CREATE_PRODUCT", ...data, stallIds: productDraft.stallIds },
      productDraft.id ? "商品已更新。" : "商品已新增。",
    );
    if (ok) setProductDraft(null);
  }

  async function importCatalog(file: File) {
    const form = new FormData();
    form.set("catalog", file);
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
      setMessage(`已匯入 ${payload.importedCount} 筆商品。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "商品匯入失敗。");
    } finally {
      setBusy(false);
    }
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
      await runCommand({ operation: "UPDATE_PRODUCT", productId: product.id, categoryId: product.categoryId, groupId: product.groupId, name: product.name, description: product.description, defaultPrice: product.defaultPrice, imageUrl: product.imageUrl, sortOrder: product.sortOrder, isActive: nextActive, translations: product.translations }, nextActive ? "商品已恢復。" : "商品已停用並停止各攤供應。");
    }
  }

  async function deleteProduct(product: Product) {
    if (!window.confirm(`確定永久刪除「${product.name}」？各攤供應與翻譯會一併移除，歷史訂單仍保留商品快照。`)) return;
    await runCommand(
      { operation: "DELETE_PRODUCT", productId: product.id },
      "商品已刪除，歷史訂單快照已保留。",
    );
  }

  function openAssignments(product: Product) {
    setAssignmentProduct(product);
    setAssignmentStallIds(product.stallProducts.map((assignment) => assignment.stallId));
  }

  async function saveAssignments() {
    if (!assignmentProduct) return;
    const ok = await runCommand(
      { operation: "SET_ASSIGNMENTS", productId: assignmentProduct.id, stallIds: assignmentStallIds },
      "攤位分派已更新。",
    );
    if (ok) setAssignmentProduct(null);
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
          <a href={`/api/merchant/organizations/${organizationId}/catalog/export`} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Download className="h-4 w-4" />匯出 CSV</a>
          <label className="inline-flex min-h-10 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Upload className="h-4 w-4" />匯入 CSV<input type="file" accept=".csv,text/csv" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void importCatalog(file); event.currentTarget.value = ""; }} /></label>
          <button type="button" onClick={() => setCategoryDraft({ name: "", sortOrder: catalog.categories.length + 1, isActive: true })} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Plus className="h-4 w-4" />分類</button>
          <button type="button" disabled={sortedCategories.length === 0} onClick={() => setGroupDraft({ categoryId: sortedCategories[0].id, name: "", sortOrder: catalog.groups.length + 1, isActive: true })} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />群組</button>
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
                <IconButton label={`編輯 ${category.name}`} onClick={(event) => { event.preventDefault(); setCategoryDraft({ ...category }); }}><Pencil className="h-4 w-4" /></IconButton>
                <IconButton label={`${category.isActive ? "停用" : "恢復"} ${category.name}`} onClick={(event) => { event.preventDefault(); void toggleActive("CATEGORY", category); }}>{category.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
              </summary>
              <div className="pb-4 pl-3 sm:pl-6">
                {groups.map((group) => (
                  <div key={group.id} className="border-l-2 border-stone-200 py-3 pl-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{group.name}</h2>
                      {!group.isActive ? <span className="text-xs text-stone-500">已停用</span> : null}
                      <span className="ml-auto text-xs text-stone-500">{productsFor(category.id, group.id).length} 項</span>
                      <IconButton label={`編輯 ${group.name}`} onClick={() => setGroupDraft({ ...group })}><Pencil className="h-4 w-4" /></IconButton>
                      <IconButton label={`${group.isActive ? "停用" : "恢復"} ${group.name}`} onClick={() => void toggleActive("GROUP", group)}>{group.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                    </div>
                    <ProductRows products={productsFor(category.id, group.id)} currency={currency} onEdit={(product) => setProductDraft({ ...product, stallIds: [] })} onAssignments={openAssignments} onToggle={(product) => void toggleActive("PRODUCT", product)} onDelete={(product) => void deleteProduct(product)} />
                  </div>
                ))}
                {ungrouped.length > 0 ? (
                  <div className="border-l-2 border-stone-200 py-3 pl-4">
                    <h2 className="text-sm font-semibold">未分組商品</h2>
                    <ProductRows products={ungrouped} currency={currency} onEdit={(product) => setProductDraft({ ...product, stallIds: [] })} onAssignments={openAssignments} onToggle={(product) => void toggleActive("PRODUCT", product)} onDelete={(product) => void deleteProduct(product)} />
                  </div>
                ) : null}
              </div>
            </details>
          );
        })}
        {sortedCategories.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">尚未建立商品分類。</p> : null}
      </div>

      {categoryDraft ? <Editor title={categoryDraft.id ? "編輯分類" : "新增分類"} onClose={() => setCategoryDraft(null)}><form onSubmit={saveCategory} className="grid gap-4"><TextField label="分類名稱" value={categoryDraft.name} onChange={(name) => setCategoryDraft({ ...categoryDraft, name })} /><NumberField label="排序" value={categoryDraft.sortOrder} onChange={(sortOrder) => setCategoryDraft({ ...categoryDraft, sortOrder })} />{categoryDraft.id ? <CheckField label="啟用分類" checked={categoryDraft.isActive} onChange={(isActive) => setCategoryDraft({ ...categoryDraft, isActive })} /> : null}<SubmitButton busy={busy} /></form></Editor> : null}

      {groupDraft ? <Editor title={groupDraft.id ? "編輯群組" : "新增群組"} onClose={() => setGroupDraft(null)}><form onSubmit={saveGroup} className="grid gap-4"><SelectField label="所屬分類" value={groupDraft.categoryId} options={sortedCategories.map((category) => ({ value: category.id, label: category.name }))} onChange={(categoryId) => setGroupDraft({ ...groupDraft, categoryId })} /><TextField label="群組名稱" value={groupDraft.name} onChange={(name) => setGroupDraft({ ...groupDraft, name })} /><NumberField label="排序" value={groupDraft.sortOrder} onChange={(sortOrder) => setGroupDraft({ ...groupDraft, sortOrder })} />{groupDraft.id ? <CheckField label="啟用群組" checked={groupDraft.isActive} onChange={(isActive) => setGroupDraft({ ...groupDraft, isActive })} /> : null}<SubmitButton busy={busy} /></form></Editor> : null}

      {productDraft ? (
        <Editor title={productDraft.id ? "編輯商品" : "新增商品"} onClose={() => setProductDraft(null)} wide>
          <form onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2">
            <TextField label="商品名稱" value={productDraft.name} onChange={(name) => setProductDraft({ ...productDraft, name })} wide />
            <SelectField label="分類" value={productDraft.categoryId} options={sortedCategories.map((category) => ({ value: category.id, label: category.name }))} onChange={(categoryId) => setProductDraft({ ...productDraft, categoryId, groupId: null })} />
            <SelectField label="群組" value={productDraft.groupId ?? ""} options={[{ value: "", label: "不分組" }, ...catalog.groups.filter((group) => group.categoryId === productDraft.categoryId).map((group) => ({ value: group.id, label: group.name }))]} onChange={(groupId) => setProductDraft({ ...productDraft, groupId: groupId || null })} />
            <NumberField label="預設售價" value={productDraft.defaultPrice} onChange={(defaultPrice) => setProductDraft({ ...productDraft, defaultPrice })} />
            <NumberField label="排序" value={productDraft.sortOrder} onChange={(sortOrder) => setProductDraft({ ...productDraft, sortOrder })} />
            <label className="text-sm font-medium text-stone-700 sm:col-span-2">商品描述<textarea maxLength={500} rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
            <div className="grid gap-3 sm:col-span-2 sm:grid-cols-[1fr_auto]">
              <label className="text-sm font-medium text-stone-700">圖片網址<input type="url" maxLength={2000} value={productDraft.imageUrl ?? ""} onChange={(event) => setProductDraft({ ...productDraft, imageUrl: event.target.value || null })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>
              <label className="mt-6 inline-flex h-10 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><ImageUp className="h-4 w-4" />本機上傳<input type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadProductImage(file); event.currentTarget.value = ""; }} /></label>
            </div>
            {productDraft.imageUrl ? <div role="img" aria-label={`${productDraft.name || "商品"}圖片預覽`} className="h-36 rounded-md border border-stone-200 bg-cover bg-center sm:col-span-2" style={{ backgroundImage: `url("${productDraft.imageUrl.replaceAll('"', "%22")}")` }} /> : null}
            <fieldset className="border-t border-stone-200 pt-4 sm:col-span-2">
              <legend className="flex items-center gap-2 text-sm font-semibold"><Languages className="h-4 w-4" />商品翻譯</legend>
              <div className="mt-3 grid gap-4">
                {translationOptions.map((option) => {
                  const translation = productDraft.translations.find((item) => item.locale === option.locale) ?? { locale: option.locale, name: "", description: "" };
                  return <div key={option.locale} className="grid gap-2 sm:grid-cols-2"><TextField label={`${option.label}名稱`} value={translation.name} onChange={(name) => updateTranslation(option.locale, { name })} /><label className="text-sm font-medium text-stone-700">{option.label}說明<textarea rows={2} maxLength={500} value={translation.description} onChange={(event) => updateTranslation(option.locale, { description: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label></div>;
                })}
              </div>
            </fieldset>
            {!productDraft.id ? <StallChecks stalls={stalls} selected={productDraft.stallIds} onChange={(stallIds) => setProductDraft({ ...productDraft, stallIds })} /> : <CheckField label="啟用商品主檔" checked={productDraft.isActive} onChange={(isActive) => setProductDraft({ ...productDraft, isActive })} />}
            <SubmitButton busy={busy} wide />
          </form>
        </Editor>
      ) : null}

      {assignmentProduct ? <Editor title={`分派「${assignmentProduct.name}」`} onClose={() => setAssignmentProduct(null)}><StallChecks stalls={stalls} selected={assignmentStallIds} onChange={setAssignmentStallIds} /><button type="button" disabled={busy} onClick={() => void saveAssignments()} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存分派</button></Editor> : null}
      <ProductNoteGroupsManager
        organizationId={organizationId}
        currency={currency}
        products={catalog.products.map((product) => ({
          id: product.id,
          name: product.name,
          categoryName: catalog.categories.find((category) => category.id === product.categoryId)?.name ?? "未分類",
          isActive: product.isActive,
        }))}
        initialNoteGroups={initialNoteGroups}
      />
    </section>
  );
}

function ProductRows({ products, currency, onEdit, onAssignments, onToggle, onDelete }: { products: Product[]; currency: string; onEdit: (product: Product) => void; onAssignments: (product: Product) => void; onToggle: (product: Product) => void; onDelete: (product: Product) => void }) {
  return <div className="mt-2 divide-y divide-stone-100">{products.map((product) => <div key={product.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate font-medium">{product.name}</span>{!product.isActive ? <span className="text-xs text-red-700">已停用</span> : null}</div><p className="mt-1 text-sm text-stone-600">{formatMoney(product.defaultPrice, currency)} · 已分派 {product.stallProducts.length} 攤</p></div><div className="flex items-center"><IconButton label={`分派 ${product.name}`} onClick={() => onAssignments(product)}><Store className="h-4 w-4" /></IconButton><IconButton label={`編輯 ${product.name}`} onClick={() => onEdit(product)}><Pencil className="h-4 w-4" /></IconButton><IconButton label={`${product.isActive ? "停用" : "恢復"} ${product.name}`} onClick={() => onToggle(product)}>{product.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton><IconButton label={`刪除 ${product.name}`} danger onClick={() => onDelete(product)}><Trash2 className="h-4 w-4" /></IconButton></div></div>)}</div>;
}

function StallChecks({ stalls, selected, onChange }: { stalls: Stall[]; selected: string[]; onChange: (ids: string[]) => void }) {
  const allSelected = stalls.length > 0 && stalls.every((stall) => selected.includes(stall.id));
  return <fieldset className="sm:col-span-2"><legend className="text-sm font-medium text-stone-700">分派攤位</legend><label className="mt-2 flex min-h-10 items-center gap-2 border-b border-stone-100"><input type="checkbox" checked={allSelected} onChange={(event) => onChange(event.target.checked ? stalls.map((stall) => stall.id) : [])} />全部授權攤位</label>{stalls.map((stall) => <label key={stall.id} className="flex min-h-10 items-center gap-2 border-b border-stone-100"><input type="checkbox" checked={selected.includes(stall.id)} onChange={(event) => onChange(event.target.checked ? [...selected, stall.id] : selected.filter((id) => id !== stall.id))} />{stall.name}{!stall.isActive ? <span className="text-xs text-stone-500">（已停用）</span> : null}</label>)}</fieldset>;
}

function Editor({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4"><section role="dialog" aria-modal="true" aria-label={title} className={`my-auto w-full rounded-lg bg-white p-5 shadow-xl ${wide ? "max-w-2xl" : "max-w-md"}`}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><IconButton label="關閉" onClick={onClose}><X className="h-4 w-4" /></IconButton></div>{children}</section></div>;
}

function IconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-stone-100 ${danger ? "text-red-700" : "text-stone-600"}`}>{children}</button>;
}

function TextField({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return <label className={`text-sm font-medium text-stone-700 ${wide ? "sm:col-span-2" : ""}`}>{label}<input required maxLength={80} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>;
}

function NumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="text-sm font-medium text-stone-700">{label}<input required type="number" min={0} max={10_000_000} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>;
}

function SelectField({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium text-stone-700">{label}<select required value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2">{options.map((option) => <option key={option.value || "none"} value={option.value}>{option.label}</option>)}</select></label>;
}

function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-10 items-center gap-2 text-sm font-medium text-stone-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}

function SubmitButton({ busy, wide = false }: { busy: boolean; wide?: boolean }) {
  return <button disabled={busy} type="submit" className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 ${wide ? "sm:col-span-2" : ""}`}><Check className="h-4 w-4" />儲存</button>;
}
