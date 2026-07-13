"use client";

import { type FormEvent, useMemo, useState } from "react";
import {
  Boxes,
  Check,
  Eye,
  Pencil,
  Plus,
  Save,
  Store,
  Trash2,
  X,
} from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";

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
  stallProducts: Assignment[];
};
type Catalog = { categories: Category[]; groups: Group[]; products: Product[] };
type Stall = { id: string; name: string; isActive: boolean };
type CategoryDraft = Omit<Category, "id"> & { id?: string };
type GroupDraft = Omit<Group, "id"> & { id?: string };
type ProductDraft = Omit<Product, "id" | "stallProducts"> & { id?: string; stallIds: string[] };

export function SharedCatalogManager({
  organizationId,
  currency,
  stalls,
  initialCatalog,
}: {
  organizationId: string;
  currency: string;
  stalls: Stall[];
  initialCatalog: Catalog;
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
    };
    const ok = await runCommand(
      productDraft.id
        ? { operation: "UPDATE_PRODUCT", productId: productDraft.id, ...data, isActive: productDraft.isActive }
        : { operation: "CREATE_PRODUCT", ...data, stallIds: productDraft.stallIds },
      productDraft.id ? "商品已更新。" : "商品已新增。",
    );
    if (ok) setProductDraft(null);
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
      await runCommand({ operation: "UPDATE_PRODUCT", productId: product.id, categoryId: product.categoryId, groupId: product.groupId, name: product.name, description: product.description, defaultPrice: product.defaultPrice, imageUrl: product.imageUrl, sortOrder: product.sortOrder, isActive: nextActive }, nextActive ? "商品已恢復。" : "商品已停用並停止各攤供應。");
    }
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
                <IconButton label={`${category.isActive ? "停用" : "恢復"} ${category.name}`} danger={category.isActive} onClick={(event) => { event.preventDefault(); void toggleActive("CATEGORY", category); }}>{category.isActive ? <Trash2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
              </summary>
              <div className="pb-4 pl-3 sm:pl-6">
                {groups.map((group) => (
                  <div key={group.id} className="border-l-2 border-stone-200 py-3 pl-4">
                    <div className="flex items-center gap-2">
                      <h2 className="text-sm font-semibold">{group.name}</h2>
                      {!group.isActive ? <span className="text-xs text-stone-500">已停用</span> : null}
                      <span className="ml-auto text-xs text-stone-500">{productsFor(category.id, group.id).length} 項</span>
                      <IconButton label={`編輯 ${group.name}`} onClick={() => setGroupDraft({ ...group })}><Pencil className="h-4 w-4" /></IconButton>
                      <IconButton label={`${group.isActive ? "停用" : "恢復"} ${group.name}`} danger={group.isActive} onClick={() => void toggleActive("GROUP", group)}>{group.isActive ? <Trash2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                    </div>
                    <ProductRows products={productsFor(category.id, group.id)} currency={currency} onEdit={(product) => setProductDraft({ ...product, stallIds: [] })} onAssignments={openAssignments} onToggle={(product) => void toggleActive("PRODUCT", product)} />
                  </div>
                ))}
                {ungrouped.length > 0 ? (
                  <div className="border-l-2 border-stone-200 py-3 pl-4">
                    <h2 className="text-sm font-semibold">未分組商品</h2>
                    <ProductRows products={ungrouped} currency={currency} onEdit={(product) => setProductDraft({ ...product, stallIds: [] })} onAssignments={openAssignments} onToggle={(product) => void toggleActive("PRODUCT", product)} />
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

      {productDraft ? <Editor title={productDraft.id ? "編輯商品" : "新增商品"} onClose={() => setProductDraft(null)} wide><form onSubmit={saveProduct} className="grid gap-4 sm:grid-cols-2"><TextField label="商品名稱" value={productDraft.name} onChange={(name) => setProductDraft({ ...productDraft, name })} wide /><SelectField label="分類" value={productDraft.categoryId} options={sortedCategories.map((category) => ({ value: category.id, label: category.name }))} onChange={(categoryId) => setProductDraft({ ...productDraft, categoryId, groupId: null })} /><SelectField label="群組" value={productDraft.groupId ?? ""} options={[{ value: "", label: "不分組" }, ...catalog.groups.filter((group) => group.categoryId === productDraft.categoryId).map((group) => ({ value: group.id, label: group.name }))]} onChange={(groupId) => setProductDraft({ ...productDraft, groupId: groupId || null })} /><NumberField label="預設售價" value={productDraft.defaultPrice} onChange={(defaultPrice) => setProductDraft({ ...productDraft, defaultPrice })} /><NumberField label="排序" value={productDraft.sortOrder} onChange={(sortOrder) => setProductDraft({ ...productDraft, sortOrder })} /><label className="text-sm font-medium text-stone-700 sm:col-span-2">商品描述<textarea maxLength={500} rows={3} value={productDraft.description} onChange={(event) => setProductDraft({ ...productDraft, description: event.target.value })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label><label className="text-sm font-medium text-stone-700 sm:col-span-2">圖片網址（選填）<input type="url" maxLength={2000} value={productDraft.imageUrl ?? ""} onChange={(event) => setProductDraft({ ...productDraft, imageUrl: event.target.value || null })} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>{!productDraft.id ? <StallChecks stalls={stalls} selected={productDraft.stallIds} onChange={(stallIds) => setProductDraft({ ...productDraft, stallIds })} /> : <CheckField label="啟用商品主檔" checked={productDraft.isActive} onChange={(isActive) => setProductDraft({ ...productDraft, isActive })} />}<SubmitButton busy={busy} wide /></form></Editor> : null}

      {assignmentProduct ? <Editor title={`分派「${assignmentProduct.name}」`} onClose={() => setAssignmentProduct(null)}><StallChecks stalls={stalls} selected={assignmentStallIds} onChange={setAssignmentStallIds} /><button type="button" disabled={busy} onClick={() => void saveAssignments()} className="mt-5 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存分派</button></Editor> : null}
    </section>
  );
}

function ProductRows({ products, currency, onEdit, onAssignments, onToggle }: { products: Product[]; currency: string; onEdit: (product: Product) => void; onAssignments: (product: Product) => void; onToggle: (product: Product) => void }) {
  return <div className="mt-2 divide-y divide-stone-100">{products.map((product) => <div key={product.id} className="grid gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"><div className="min-w-0"><div className="flex items-center gap-2"><span className="truncate font-medium">{product.name}</span>{!product.isActive ? <span className="text-xs text-red-700">已停用</span> : null}</div><p className="mt-1 text-sm text-stone-600">{formatMoney(product.defaultPrice, currency)} · 已分派 {product.stallProducts.length} 攤</p></div><div className="flex items-center"><IconButton label={`分派 ${product.name}`} onClick={() => onAssignments(product)}><Store className="h-4 w-4" /></IconButton><IconButton label={`編輯 ${product.name}`} onClick={() => onEdit(product)}><Pencil className="h-4 w-4" /></IconButton><IconButton label={`${product.isActive ? "停用" : "恢復"} ${product.name}`} danger={product.isActive} onClick={() => onToggle(product)}>{product.isActive ? <Trash2 className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton></div></div>)}</div>;
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
