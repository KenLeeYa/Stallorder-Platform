"use client";

import { type FormEvent, useMemo, useState } from "react";
import { Check, Eye, EyeOff, MessageSquareText, Pencil, Plus, Trash2, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";

type Translation = { locale: string; name: string };
type NoteOption = {
  id: string;
  name: string;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
  translations: Translation[];
};
export type ProductNoteGroupView = {
  id: string;
  name: string;
  selectionMode: "SINGLE" | "MULTIPLE";
  isRequired: boolean;
  minSelections: number;
  maxSelections: number | null;
  sortOrder: number;
  isActive: boolean;
  translations: Translation[];
  assignments: Array<{ productId: string }>;
  options: NoteOption[];
};
type ProductRef = { id: string; name: string; categoryName: string; isActive: boolean };
type GroupDraft = Omit<ProductNoteGroupView, "id" | "assignments" | "options"> & {
  id?: string;
  productIds: string[];
};
type OptionDraft = Omit<NoteOption, "id"> & { id?: string; noteGroupId: string };

const translationOptions = [
  { locale: "en", label: "英文" },
  { locale: "ja", label: "日文" },
  { locale: "ko", label: "韓文" },
  { locale: "vi", label: "越南文" },
  { locale: "th", label: "泰文" },
] as const;

export function ProductNoteGroupsManager({
  organizationId,
  currency,
  products,
  initialNoteGroups,
}: {
  organizationId: string;
  currency: string;
  products: ProductRef[];
  initialNoteGroups: ProductNoteGroupView[];
}) {
  const [groups, setGroups] = useState(initialNoteGroups);
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [optionDraft, setOptionDraft] = useState<OptionDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const sortedGroups = useMemo(
    () => [...groups].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW")),
    [groups],
  );
  const productsByCategory = useMemo(() => {
    const categories = new Map<string, ProductRef[]>();
    products.forEach((product) => categories.set(product.categoryName, [...(categories.get(product.categoryName) ?? []), product]));
    return [...categories.entries()];
  }, [products]);

  async function runCommand(command: Record<string, unknown>, successMessage: string) {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/product-notes`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法更新註記群組。");
      setGroups(payload.noteGroups);
      setMessage(successMessage);
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新註記群組。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function editGroup(group: ProductNoteGroupView) {
    setGroupDraft({
      id: group.id,
      name: group.name,
      selectionMode: group.selectionMode,
      isRequired: group.isRequired,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      sortOrder: group.sortOrder,
      isActive: group.isActive,
      translations: group.translations,
      productIds: group.assignments.map((assignment) => assignment.productId),
    });
  }

  async function saveGroup(event: FormEvent) {
    event.preventDefault();
    if (!groupDraft) return;
    const command = {
      operation: groupDraft.id ? "UPDATE_NOTE_GROUP" : "CREATE_NOTE_GROUP",
      ...(groupDraft.id ? { noteGroupId: groupDraft.id } : {}),
      name: groupDraft.name,
      selectionMode: groupDraft.selectionMode,
      isRequired: groupDraft.isRequired,
      minSelections: groupDraft.minSelections,
      maxSelections: groupDraft.selectionMode === "SINGLE" ? 1 : groupDraft.maxSelections,
      sortOrder: groupDraft.sortOrder,
      isActive: groupDraft.isActive,
      productIds: groupDraft.productIds,
      translations: groupDraft.translations.filter((translation) => translation.name.trim()),
    };
    if (await runCommand(command, groupDraft.id ? "註記群組已更新。" : "註記群組已新增。")) setGroupDraft(null);
  }

  async function saveOption(event: FormEvent) {
    event.preventDefault();
    if (!optionDraft) return;
    const command = {
      operation: optionDraft.id ? "UPDATE_NOTE_OPTION" : "CREATE_NOTE_OPTION",
      ...(optionDraft.id ? { noteOptionId: optionDraft.id } : { noteGroupId: optionDraft.noteGroupId }),
      name: optionDraft.name,
      priceDelta: optionDraft.priceDelta,
      sortOrder: optionDraft.sortOrder,
      isActive: optionDraft.isActive,
      translations: optionDraft.translations.filter((translation) => translation.name.trim()),
    };
    if (await runCommand(command, optionDraft.id ? "註記選項已更新。" : "註記選項已新增。")) setOptionDraft(null);
  }

  async function toggleGroup(group: ProductNoteGroupView) {
    await runCommand({
      operation: "UPDATE_NOTE_GROUP",
      noteGroupId: group.id,
      name: group.name,
      selectionMode: group.selectionMode,
      isRequired: group.isRequired,
      minSelections: group.minSelections,
      maxSelections: group.maxSelections,
      sortOrder: group.sortOrder,
      isActive: !group.isActive,
      productIds: group.assignments.map((assignment) => assignment.productId),
      translations: group.translations,
    }, group.isActive ? "註記群組已停用。" : "註記群組已啟用。");
  }

  async function toggleOption(option: NoteOption) {
    await runCommand({
      operation: "UPDATE_NOTE_OPTION",
      noteOptionId: option.id,
      name: option.name,
      priceDelta: option.priceDelta,
      sortOrder: option.sortOrder,
      isActive: !option.isActive,
      translations: option.translations,
    }, option.isActive ? "註記選項已停用。" : "註記選項已啟用。");
  }

  async function deleteGroup(group: ProductNoteGroupView) {
    if (!window.confirm(`確定刪除註記群組「${group.name}」？歷史訂單會保留原始快照。`)) return;
    await runCommand({ operation: "DELETE_NOTE_GROUP", noteGroupId: group.id }, "註記群組已刪除。");
  }

  async function deleteOption(option: NoteOption) {
    if (!window.confirm(`確定刪除註記選項「${option.name}」？歷史訂單會保留原始快照。`)) return;
    await runCommand({ operation: "DELETE_NOTE_OPTION", noteOptionId: option.id }, "註記選項已刪除。");
  }

  return (
    <section aria-labelledby="product-notes-heading" className="mt-10 border-t border-stone-200 pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-800">商品客製化</p>
          <h2 id="product-notes-heading" className="mt-1 text-2xl font-semibold">商品註記群組</h2>
        </div>
        <button type="button" onClick={() => setGroupDraft({ name: "", selectionMode: "MULTIPLE", isRequired: false, minSelections: 0, maxSelections: null, sortOrder: groups.length + 1, isActive: true, translations: [], productIds: [] })} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white">
          <Plus className="h-4 w-4" />新增群組
        </button>
      </div>

      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      <div className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
        {sortedGroups.map((group) => {
          const assignedNames = group.assignments
            .map((assignment) => products.find((product) => product.id === assignment.productId)?.name)
            .filter(Boolean);
          return (
            <details key={group.id} open className="py-1">
              <summary className="flex min-h-16 cursor-pointer list-none items-center gap-3 py-3 [&::-webkit-details-marker]:hidden">
                <MessageSquareText className="h-4 w-4 shrink-0 text-teal-700" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><strong>{group.name}</strong>{!group.isActive ? <span className="text-xs text-red-700">已停用</span> : null}</div>
                  <p className="mt-1 truncate text-xs text-stone-500">{group.selectionMode === "SINGLE" ? "單選" : "複選"} · {group.isRequired ? "必選" : "選填"} · 最少 {group.minSelections} 項 · 最多 {group.maxSelections ?? "不限"} 項 · {assignedNames.length} 項商品</p>
                </div>
                <div className="ml-auto flex items-center">
                  <IconButton label={`編輯 ${group.name}`} onClick={(event) => { event.preventDefault(); editGroup(group); }}><Pencil className="h-4 w-4" /></IconButton>
                  <IconButton label={`${group.isActive ? "停用" : "啟用"} ${group.name}`} onClick={(event) => { event.preventDefault(); void toggleGroup(group); }}>{group.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                  <IconButton label={`刪除 ${group.name}`} danger onClick={(event) => { event.preventDefault(); void deleteGroup(group); }}><Trash2 className="h-4 w-4" /></IconButton>
                </div>
              </summary>
              <div className="pb-4 pl-7">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs text-stone-500">{assignedNames.length > 0 ? assignedNames.join("、") : "尚未指派商品"}</p>
                  <button type="button" onClick={() => setOptionDraft({ noteGroupId: group.id, name: "", priceDelta: 0, sortOrder: group.options.length + 1, isActive: true, translations: [] })} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold"><Plus className="h-4 w-4" />註記選項</button>
                </div>
                <div className="divide-y divide-stone-100">
                  {group.options.map((option) => (
                    <div key={option.id} className="grid min-h-12 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                      <div><span className="text-sm font-medium">{option.name}</span><span className="ml-2 text-xs text-stone-500">{option.priceDelta === 0 ? "不加價" : `${option.priceDelta > 0 ? "+" : ""}${formatMoney(option.priceDelta, currency)}`}</span>{!option.isActive ? <span className="ml-2 text-xs text-red-700">已停用</span> : null}</div>
                      <div className="flex items-center">
                        <IconButton label={`編輯 ${option.name}`} onClick={() => setOptionDraft({ ...option, noteGroupId: group.id })}><Pencil className="h-4 w-4" /></IconButton>
                        <IconButton label={`${option.isActive ? "停用" : "啟用"} ${option.name}`} onClick={() => void toggleOption(option)}>{option.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                        <IconButton label={`刪除 ${option.name}`} danger onClick={() => void deleteOption(option)}><Trash2 className="h-4 w-4" /></IconButton>
                      </div>
                    </div>
                  ))}
                  {group.options.length === 0 ? <p className="py-4 text-sm text-stone-500">尚未建立註記選項。</p> : null}
                </div>
              </div>
            </details>
          );
        })}
        {groups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">尚未建立商品註記群組。</p> : null}
      </div>

      {groupDraft ? (
        <Editor title={groupDraft.id ? "編輯註記群組" : "新增註記群組"} onClose={() => setGroupDraft(null)} wide>
          <form onSubmit={saveGroup} className="grid gap-4 sm:grid-cols-2">
            <TextField label="群組名稱" value={groupDraft.name} onChange={(name) => setGroupDraft({ ...groupDraft, name })} wide />
            <SelectField label="選取方式" value={groupDraft.selectionMode} options={[{ value: "SINGLE", label: "單選" }, { value: "MULTIPLE", label: "複選" }]} onChange={(selectionMode) => setGroupDraft({ ...groupDraft, selectionMode: selectionMode as GroupDraft["selectionMode"], minSelections: selectionMode === "SINGLE" ? Math.min(groupDraft.minSelections, 1) : groupDraft.minSelections, maxSelections: selectionMode === "SINGLE" ? 1 : null })} />
            <NumberField label="最少選取數" value={groupDraft.minSelections} min={0} max={groupDraft.selectionMode === "SINGLE" ? 1 : 20} onChange={(minSelections) => setGroupDraft({ ...groupDraft, minSelections, isRequired: minSelections > 0 })} />
            {groupDraft.selectionMode === "MULTIPLE" ? <OptionalNumberField label="最多選取數" value={groupDraft.maxSelections} min={Math.max(1, groupDraft.minSelections)} onChange={(maxSelections) => setGroupDraft({ ...groupDraft, maxSelections })} /> : <div />}
            <NumberField label="排序" value={groupDraft.sortOrder} onChange={(sortOrder) => setGroupDraft({ ...groupDraft, sortOrder })} />
            <div className="grid content-center gap-2"><CheckField label="顧客必須選擇" checked={groupDraft.isRequired} onChange={(isRequired) => setGroupDraft({ ...groupDraft, isRequired, minSelections: isRequired ? Math.max(1, groupDraft.minSelections) : 0 })} /><CheckField label="啟用群組" checked={groupDraft.isActive} onChange={(isActive) => setGroupDraft({ ...groupDraft, isActive })} /></div>
            <fieldset className="sm:col-span-2"><legend className="text-sm font-semibold text-stone-700">指派商品</legend><div className="mt-2 max-h-56 overflow-y-auto border-y border-stone-200">{productsByCategory.map(([categoryName, categoryProducts]) => <details key={categoryName} open><summary className="cursor-pointer py-2 text-sm font-semibold">{categoryName}</summary><div className="pb-2 pl-3">{categoryProducts.map((product) => <label key={product.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={groupDraft.productIds.includes(product.id)} onChange={(event) => setGroupDraft({ ...groupDraft, productIds: event.target.checked ? [...groupDraft.productIds, product.id] : groupDraft.productIds.filter((id) => id !== product.id) })} />{product.name}{!product.isActive ? <span className="text-xs text-stone-500">（已停用）</span> : null}</label>)}</div></details>)}</div></fieldset>
            <TranslationFields translations={groupDraft.translations} onChange={(translations) => setGroupDraft({ ...groupDraft, translations })} />
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {optionDraft ? (
        <Editor title={optionDraft.id ? "編輯註記選項" : "新增註記選項"} onClose={() => setOptionDraft(null)}>
          <form onSubmit={saveOption} className="grid gap-4">
            <TextField label="註記名稱" value={optionDraft.name} onChange={(name) => setOptionDraft({ ...optionDraft, name })} />
            <SignedNumberField label="價格調整" value={optionDraft.priceDelta} onChange={(priceDelta) => setOptionDraft({ ...optionDraft, priceDelta })} />
            <NumberField label="排序" value={optionDraft.sortOrder} onChange={(sortOrder) => setOptionDraft({ ...optionDraft, sortOrder })} />
            <CheckField label="啟用選項" checked={optionDraft.isActive} onChange={(isActive) => setOptionDraft({ ...optionDraft, isActive })} />
            <TranslationFields translations={optionDraft.translations} onChange={(translations) => setOptionDraft({ ...optionDraft, translations })} />
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}
    </section>
  );
}

function TranslationFields({ translations, onChange }: { translations: Translation[]; onChange: (items: Translation[]) => void }) {
  return <details className="border-t border-stone-200 pt-3 sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold">多語名稱</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{translationOptions.map((option) => { const current = translations.find((item) => item.locale === option.locale)?.name ?? ""; return <label key={option.locale} className="text-sm font-medium text-stone-700">{option.label}<input type="text" maxLength={120} value={current} onChange={(event) => { const next = translations.filter((item) => item.locale !== option.locale); if (event.target.value) next.push({ locale: option.locale, name: event.target.value }); onChange(next); }} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>; })}</div></details>;
}

function Editor({ title, onClose, wide = false, children }: { title: string; onClose: () => void; wide?: boolean; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4"><section role="dialog" aria-modal="true" aria-label={title} className={`my-auto w-full rounded-lg bg-white p-5 shadow-xl ${wide ? "max-w-2xl" : "max-w-md"}`}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><IconButton label="關閉" onClick={onClose}><X className="h-4 w-4" /></IconButton></div>{children}</section></div>;
}

function IconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-stone-100 ${danger ? "text-red-700" : "text-stone-600"}`}>{children}</button>;
}
function TextField({ label, value, onChange, wide = false }: { label: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  return <label className={`text-sm font-medium text-stone-700 ${wide ? "sm:col-span-2" : ""}`}>{label}<input type="text" required maxLength={80} value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>;
}
function NumberField({ label, value, min = 0, max = 10_000, onChange }: { label: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  return <label className="text-sm font-medium text-stone-700">{label}<input required type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>;
}
function SignedNumberField({ label, value, onChange }: { label: string; value: number; onChange: (value: number) => void }) {
  return <label className="text-sm font-medium text-stone-700">{label}<input required type="number" min={-10_000_000} max={10_000_000} value={value} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>;
}
function OptionalNumberField({ label, value, min = 1, onChange }: { label: string; value: number | null; min?: number; onChange: (value: number | null) => void }) {
  return <label className="text-sm font-medium text-stone-700">{label}<input type="number" min={min} max={20} placeholder="不限" value={value ?? ""} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>;
}
function SelectField({ label, value, options, onChange }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  return <label className="text-sm font-medium text-stone-700">{label}<select value={value} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-stone-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
function SubmitButton({ busy }: { busy: boolean }) {
  return <button disabled={busy} type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"><Check className="h-4 w-4" />儲存</button>;
}
