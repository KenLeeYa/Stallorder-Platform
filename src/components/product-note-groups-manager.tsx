"use client";

import { type FormEvent, useMemo, useRef, useState } from "react";
import { Check, Eye, EyeOff, MessageSquareText, Pencil, Plus, Trash2, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  getTranslationLocaleOptions,
  type TranslationLocale,
} from "@/lib/enabled-locales";
import { formatMoney } from "@/lib/money";
import { nextProductNoteSortOrder } from "@/lib/product-note-sort";

type Translation = { locale: string; name: string };
type NoteOption = {
  id: string;
  reusableNoteId: string | null;
  name: string;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
  translations: Translation[];
};
export type ReusableProductNoteView = {
  id: string;
  name: string;
  priceDelta: number;
  sortOrder: number;
  isActive: boolean;
  translations: Translation[];
  linkedOptionCount: number;
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
type ReusableNoteDraft = Omit<ReusableProductNoteView, "id" | "linkedOptionCount"> & { id?: string };

export function ProductNoteGroupsManager({
  organizationId,
  currency,
  products,
  initialNoteGroups,
  initialReusableNotes,
  enabledTranslationLocales,
  onChange,
}: {
  organizationId: string;
  currency: string;
  products: ProductRef[];
  initialNoteGroups: ProductNoteGroupView[];
  initialReusableNotes: ReusableProductNoteView[];
  enabledTranslationLocales: TranslationLocale[];
  onChange?: (noteGroups: ProductNoteGroupView[], reusableNotes: ReusableProductNoteView[]) => void;
}) {
  const [groups, setGroups] = useState(initialNoteGroups);
  const [reusableNotes, setReusableNotes] = useState(initialReusableNotes);
  const [activeTab, setActiveTab] = useState<"NOTES" | "GROUPS">("NOTES");
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [optionDraft, setOptionDraft] = useState<OptionDraft | null>(null);
  const [reusableNoteDraft, setReusableNoteDraft] = useState<ReusableNoteDraft | null>(null);
  const [attachSelections, setAttachSelections] = useState<Record<string, string>>({});
  const [attachFieldErrors, setAttachFieldErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editorMessage, setEditorMessage] = useState("");
  const [editorFieldErrors, setEditorFieldErrors] = useState<Record<string, string>>({});
  const editorRef = useRef<HTMLElement>(null);
  const managerRef = useRef<HTMLElement>(null);
  const translationOptions = getTranslationLocaleOptions(enabledTranslationLocales);
  const sortedGroups = useMemo(
    () => [...groups].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW")),
    [groups],
  );
  const sortedReusableNotes = useMemo(
    () => [...reusableNotes].sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW")),
    [reusableNotes],
  );
  const productsByCategory = useMemo(() => {
    const categories = new Map<string, ProductRef[]>();
    products.forEach((product) => categories.set(product.categoryName, [...(categories.get(product.categoryName) ?? []), product]));
    return [...categories.entries()];
  }, [products]);

  function clearEditorFeedback() {
    setEditorMessage("");
    setEditorFieldErrors({});
  }

  function clearEditorField(field: string) {
    setEditorFieldErrors((current) => {
      if (!current[field]) return current;
      const next = { ...current };
      delete next[field];
      return next;
    });
  }

  async function runCommand(command: Record<string, unknown>, successMessage: string, inEditor = false) {
    setBusy(true);
    if (inEditor) clearEditorFeedback();
    else setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/product-notes`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as {
        error?: string;
        fieldErrors?: Record<string, string>;
        noteGroups: ProductNoteGroupView[];
        reusableNotes: ReusableProductNoteView[];
      };
      if (!response.ok) {
        const errorMessage = payload.error ?? "目前無法更新註記群組。";
        if (inEditor) {
          const nextFieldErrors = payload.fieldErrors ?? {};
          setEditorMessage(errorMessage);
          setEditorFieldErrors(nextFieldErrors);
          const firstField = Object.keys(nextFieldErrors)[0];
          if (firstField) requestAnimationFrame(() => editorRef.current?.querySelector<HTMLElement>(`[data-field-key="${firstField}"]`)?.focus());
        } else {
          setMessage(errorMessage);
        }
        return false;
      }
      setGroups(payload.noteGroups);
      setReusableNotes(payload.reusableNotes);
      onChange?.(payload.noteGroups, payload.reusableNotes);
      setMessage(successMessage);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "目前無法更新註記群組。";
      if (inEditor) setEditorMessage(errorMessage);
      else setMessage(errorMessage);
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
    if (await runCommand(command, groupDraft.id ? "註記群組已更新。" : "註記群組已新增。", true)) setGroupDraft(null);
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
    if (await runCommand(command, optionDraft.id ? "註記選項已更新。" : "註記選項已新增。", true)) setOptionDraft(null);
  }

  async function saveReusableNote(event: FormEvent) {
    event.preventDefault();
    if (!reusableNoteDraft) return;
    const command = {
      operation: reusableNoteDraft.id ? "UPDATE_REUSABLE_NOTE" : "CREATE_REUSABLE_NOTE",
      ...(reusableNoteDraft.id ? { reusableNoteId: reusableNoteDraft.id } : {}),
      name: reusableNoteDraft.name,
      priceDelta: reusableNoteDraft.priceDelta,
      sortOrder: reusableNoteDraft.sortOrder,
      isActive: reusableNoteDraft.isActive,
      translations: reusableNoteDraft.translations.filter((translation) => translation.name.trim()),
    };
    if (await runCommand(command, reusableNoteDraft.id ? "共用單一註記已更新，所有群組已同步。" : "共用單一註記已新增。", true)) {
      setReusableNoteDraft(null);
    }
  }

  async function toggleReusableNote(note: ReusableProductNoteView) {
    await runCommand({
      operation: "UPDATE_REUSABLE_NOTE",
      reusableNoteId: note.id,
      name: note.name,
      priceDelta: note.priceDelta,
      sortOrder: note.sortOrder,
      isActive: !note.isActive,
      translations: note.translations,
    }, note.isActive ? "共用單一註記已停用，所有群組已同步。" : "共用單一註記已啟用，所有群組已同步。");
  }

  async function deleteReusableNote(note: ReusableProductNoteView) {
    if (!window.confirm(`確定刪除共用單一註記「${note.name}」？仍在群組中使用時系統會拒絕刪除。`)) return;
    await runCommand(
      { operation: "DELETE_REUSABLE_NOTE", reusableNoteId: note.id },
      "共用單一註記已刪除。",
    );
  }

  async function attachReusableNote(group: ProductNoteGroupView) {
    const reusableNoteId = attachSelections[group.id];
    if (!reusableNoteId) {
      const error = "請先選擇要加入群組的共用單一註記。";
      setMessage(error);
      setAttachFieldErrors((current) => ({ ...current, [group.id]: error }));
      requestAnimationFrame(() => {
        managerRef.current
          ?.querySelector<HTMLElement>(`[data-field-key="attach-${group.id}-reusableNoteId"]`)
          ?.focus();
      });
      return;
    }
    const sortOrder = nextProductNoteSortOrder(group.options);
    const attached = await runCommand(
      { operation: "ATTACH_REUSABLE_NOTE", noteGroupId: group.id, reusableNoteId, sortOrder },
      "共用單一註記已加入群組。",
    );
    if (attached) {
      setAttachSelections((current) => ({ ...current, [group.id]: "" }));
      setAttachFieldErrors((current) => {
        const next = { ...current };
        delete next[group.id];
        return next;
      });
    }
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
    const action = option.reusableNoteId ? "從此群組移除" : "刪除";
    if (!window.confirm(`確定${action}註記選項「${option.name}」？歷史訂單會保留原始快照。`)) return;
    await runCommand(
      { operation: "DELETE_NOTE_OPTION", noteOptionId: option.id },
      option.reusableNoteId ? "共用註記已從群組移除。" : "註記選項已刪除。",
    );
  }

  return (
    <section ref={managerRef} aria-labelledby="product-notes-heading" className="mt-10 border-t border-stone-200 pt-7">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-800">商品客製化</p>
          <h2 id="product-notes-heading" className="mt-1 text-2xl font-semibold">商品註記設定</h2>
        </div>
        <button
          type="button"
          onClick={() => activeTab === "NOTES"
            ? setReusableNoteDraft({ name: "", priceDelta: 0, sortOrder: nextProductNoteSortOrder(reusableNotes), isActive: true, translations: [] })
            : setGroupDraft({ name: "", selectionMode: "MULTIPLE", isRequired: false, minSelections: 0, maxSelections: null, sortOrder: nextProductNoteSortOrder(groups), isActive: true, translations: [], productIds: [] })}
          className="inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white"
        >
          <Plus className="h-4 w-4" />{activeTab === "NOTES" ? "新增單一註記" : "新增群組"}
        </button>
      </div>

      <div role="tablist" aria-label="商品註記設定" className="mt-5 flex gap-1 border-b border-stone-200">
        <button type="button" role="tab" aria-selected={activeTab === "NOTES"} onClick={() => setActiveTab("NOTES")} className={`min-h-11 border-b-2 px-4 text-sm font-semibold ${activeTab === "NOTES" ? "border-teal-700 text-teal-800" : "border-transparent text-stone-500"}`}>所有單一註記</button>
        <button type="button" role="tab" aria-selected={activeTab === "GROUPS"} onClick={() => setActiveTab("GROUPS")} className={`min-h-11 border-b-2 px-4 text-sm font-semibold ${activeTab === "GROUPS" ? "border-teal-700 text-teal-800" : "border-transparent text-stone-500"}`}>註記群組</button>
      </div>
      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      {activeTab === "NOTES" ? (
        <div role="tabpanel" className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
          {sortedReusableNotes.map((note) => (
            <div key={note.id} className="grid min-h-16 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2"><strong>{note.name}</strong>{!note.isActive ? <span className="text-xs text-red-700">已停用</span> : null}</div>
                <p className="mt-1 text-xs text-stone-500">{note.priceDelta === 0 ? "不加價" : `${note.priceDelta > 0 ? "+" : ""}${formatMoney(note.priceDelta, currency)}`} · 排序 {note.sortOrder} · 已加入 {note.linkedOptionCount} 個群組</p>
              </div>
              <div className="flex items-center">
                <IconButton label={`編輯 ${note.name}`} onClick={() => setReusableNoteDraft({ id: note.id, name: note.name, priceDelta: note.priceDelta, sortOrder: note.sortOrder, isActive: note.isActive, translations: note.translations })}><Pencil className="h-4 w-4" /></IconButton>
                <IconButton label={`${note.isActive ? "停用" : "啟用"} ${note.name}`} onClick={() => void toggleReusableNote(note)}>{note.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                <IconButton label={`刪除 ${note.name}`} danger onClick={() => void deleteReusableNote(note)}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            </div>
          ))}
          {reusableNotes.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">尚未建立共用單一註記。</p> : null}
        </div>
      ) : (
        <div role="tabpanel" className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
          {sortedGroups.map((group) => {
            const assignedNames = group.assignments
              .map((assignment) => products.find((product) => product.id === assignment.productId)?.name)
              .filter(Boolean);
            const availableReusableNotes = sortedReusableNotes.filter((note) => !group.options.some((option) => option.reusableNoteId === note.id));
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
                  <p className="mb-3 text-xs text-stone-500">{assignedNames.length > 0 ? assignedNames.join("、") : "尚未指派商品"}</p>
                  <div className="mb-3 flex flex-wrap items-end gap-2 rounded-md bg-stone-50 p-3">
                    <SelectField label="加入既有共用註記" fieldKey={`attach-${group.id}-reusableNoteId`} error={attachFieldErrors[group.id]} value={attachSelections[group.id] ?? ""} options={[{ value: "", label: availableReusableNotes.length > 0 ? "請選擇" : "沒有可加入的註記" }, ...availableReusableNotes.map((note) => ({ value: note.id, label: note.name }))]} onChange={(reusableNoteId) => { setAttachFieldErrors((current) => { const next = { ...current }; delete next[group.id]; return next; }); setAttachSelections((current) => ({ ...current, [group.id]: reusableNoteId })); }} />
                    <button type="button" disabled={busy} onClick={() => void attachReusableNote(group)} className="min-h-10 rounded-md border border-teal-700 px-3 text-xs font-semibold text-teal-800 disabled:opacity-50">加入群組</button>
                    <button type="button" onClick={() => setOptionDraft({ noteGroupId: group.id, reusableNoteId: null, name: "", priceDelta: 0, sortOrder: nextProductNoteSortOrder(group.options), isActive: true, translations: [] })} className="ml-auto inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold"><Plus className="h-4 w-4" />新增群組專用註記</button>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {group.options.map((option) => (
                      <div key={option.id} className="grid min-h-12 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div><span className="text-sm font-medium">{option.name}</span><span className="ml-2 text-xs text-stone-500">{option.priceDelta === 0 ? "不加價" : `${option.priceDelta > 0 ? "+" : ""}${formatMoney(option.priceDelta, currency)}`}</span><span className="ml-2 text-xs text-teal-700">{option.reusableNoteId ? "共用單一註記" : "群組專用"}</span>{!option.isActive ? <span className="ml-2 text-xs text-red-700">已停用</span> : null}</div>
                        <div className="flex items-center">
                          <IconButton label={`${option.reusableNoteId ? "調整排序" : "編輯"} ${option.name}`} onClick={() => setOptionDraft({ ...option, noteGroupId: group.id })}><Pencil className="h-4 w-4" /></IconButton>
                          {!option.reusableNoteId ? <IconButton label={`${option.isActive ? "停用" : "啟用"} ${option.name}`} onClick={() => void toggleOption(option)}>{option.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton> : null}
                          <IconButton label={`${option.reusableNoteId ? "從群組移除" : "刪除"} ${option.name}`} danger onClick={() => void deleteOption(option)}><Trash2 className="h-4 w-4" /></IconButton>
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
      )}

      {groupDraft ? (
        <Editor title={groupDraft.id ? "編輯註記群組" : "新增註記群組"} onClose={() => { clearEditorFeedback(); setGroupDraft(null); }} dialogRef={editorRef} errorMessage={editorMessage} wide>
          <form noValidate onSubmit={saveGroup} className="grid gap-4 sm:grid-cols-2">
            <TextField label="群組名稱" fieldKey="name" error={editorFieldErrors.name} value={groupDraft.name} onChange={(name) => { clearEditorField("name"); setGroupDraft({ ...groupDraft, name }); }} wide />
            <SelectField label="選取方式" value={groupDraft.selectionMode} options={[{ value: "SINGLE", label: "單選" }, { value: "MULTIPLE", label: "複選" }]} onChange={(selectionMode) => setGroupDraft({ ...groupDraft, selectionMode: selectionMode as GroupDraft["selectionMode"], minSelections: selectionMode === "SINGLE" ? Math.min(groupDraft.minSelections, 1) : groupDraft.minSelections, maxSelections: selectionMode === "SINGLE" ? 1 : null })} />
            <NumberField label="最少選取數" fieldKey="minSelections" error={editorFieldErrors.minSelections} value={groupDraft.minSelections} min={0} max={groupDraft.selectionMode === "SINGLE" ? 1 : 20} onChange={(minSelections) => { clearEditorField("minSelections"); setGroupDraft({ ...groupDraft, minSelections, isRequired: minSelections > 0 }); }} />
            {groupDraft.selectionMode === "MULTIPLE" ? <OptionalNumberField label="最多選取數" fieldKey="maxSelections" error={editorFieldErrors.maxSelections} value={groupDraft.maxSelections} min={1} onChange={(maxSelections) => { clearEditorField("maxSelections"); setGroupDraft({ ...groupDraft, maxSelections }); }} /> : <div />}
            <NumberField label="排序" fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={groupDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setGroupDraft({ ...groupDraft, sortOrder }); }} />
            <div className="grid content-center gap-2"><CheckField label="顧客必須選擇" checked={groupDraft.isRequired} onChange={(isRequired) => setGroupDraft({ ...groupDraft, isRequired, minSelections: isRequired ? Math.max(1, groupDraft.minSelections) : 0 })} /><CheckField label="啟用群組" checked={groupDraft.isActive} onChange={(isActive) => setGroupDraft({ ...groupDraft, isActive })} /></div>
            <fieldset tabIndex={-1} data-field-key="productIds" aria-invalid={Boolean(editorFieldErrors.productIds)} aria-describedby={editorFieldErrors.productIds ? "product-note-productIds-error" : undefined} className={`sm:col-span-2 rounded-md ${editorFieldErrors.productIds ? "border border-red-500 bg-red-50 p-2" : ""}`}><legend className="text-sm font-semibold text-stone-700">指派商品</legend><div className="mt-2 max-h-56 overflow-y-auto border-y border-stone-200">{productsByCategory.map(([categoryName, categoryProducts]) => <details key={categoryName} open><summary className="cursor-pointer py-2 text-sm font-semibold">{categoryName}</summary><div className="pb-2 pl-3">{categoryProducts.map((product) => <label key={product.id} className="flex min-h-9 items-center gap-2 text-sm"><input type="checkbox" checked={groupDraft.productIds.includes(product.id)} onChange={(event) => { clearEditorField("productIds"); setGroupDraft({ ...groupDraft, productIds: event.target.checked ? [...groupDraft.productIds, product.id] : groupDraft.productIds.filter((id) => id !== product.id) }); }} />{product.name}{!product.isActive ? <span className="text-xs text-stone-500">（已停用）</span> : null}</label>)}</div></details>)}</div>{editorFieldErrors.productIds ? <span id="product-note-productIds-error" role="alert" className="mt-1 block text-xs text-red-700">{editorFieldErrors.productIds}</span> : null}</fieldset>
            <TranslationFields translations={groupDraft.translations} options={translationOptions} onChange={(translations) => setGroupDraft({ ...groupDraft, translations })} />
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {reusableNoteDraft ? (
        <Editor title={reusableNoteDraft.id ? "編輯共用單一註記" : "新增共用單一註記"} onClose={() => { clearEditorFeedback(); setReusableNoteDraft(null); }} dialogRef={editorRef} errorMessage={editorMessage}>
          <form noValidate onSubmit={saveReusableNote} className="grid gap-4">
            <TextField label="註記名稱" fieldKey="name" error={editorFieldErrors.name} value={reusableNoteDraft.name} onChange={(name) => { clearEditorField("name"); setReusableNoteDraft({ ...reusableNoteDraft, name }); }} />
            <SignedNumberField label="價格調整" fieldKey="priceDelta" error={editorFieldErrors.priceDelta} value={reusableNoteDraft.priceDelta} onChange={(priceDelta) => { clearEditorField("priceDelta"); setReusableNoteDraft({ ...reusableNoteDraft, priceDelta }); }} />
            <NumberField label="排序" fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={reusableNoteDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setReusableNoteDraft({ ...reusableNoteDraft, sortOrder }); }} />
            <CheckField label="啟用註記" checked={reusableNoteDraft.isActive} onChange={(isActive) => setReusableNoteDraft({ ...reusableNoteDraft, isActive })} />
            <TranslationFields translations={reusableNoteDraft.translations} options={translationOptions} onChange={(translations) => setReusableNoteDraft({ ...reusableNoteDraft, translations })} />
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {optionDraft ? (
        <Editor title={optionDraft.reusableNoteId ? "調整群組內排序" : optionDraft.id ? "編輯群組專用註記" : "新增群組專用註記"} onClose={() => { clearEditorFeedback(); setOptionDraft(null); }} dialogRef={editorRef} errorMessage={editorMessage}>
          <form noValidate onSubmit={saveOption} className="grid gap-4">
            {optionDraft.reusableNoteId ? <p className="text-sm text-stone-600">「{optionDraft.name}」的名稱、價差、啟用狀態與翻譯由共用單一註記同步管理；此處只調整它在本群組內的排序。</p> : <>
              <TextField label="註記名稱" fieldKey="name" error={editorFieldErrors.name} value={optionDraft.name} onChange={(name) => { clearEditorField("name"); setOptionDraft({ ...optionDraft, name }); }} />
              <SignedNumberField label="價格調整" fieldKey="priceDelta" error={editorFieldErrors.priceDelta} value={optionDraft.priceDelta} onChange={(priceDelta) => { clearEditorField("priceDelta"); setOptionDraft({ ...optionDraft, priceDelta }); }} />
            </>}
            <NumberField label="排序" fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={optionDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setOptionDraft({ ...optionDraft, sortOrder }); }} />
            {!optionDraft.reusableNoteId ? <>
              <CheckField label="啟用選項" checked={optionDraft.isActive} onChange={(isActive) => setOptionDraft({ ...optionDraft, isActive })} />
              <TranslationFields translations={optionDraft.translations} options={translationOptions} onChange={(translations) => setOptionDraft({ ...optionDraft, translations })} />
            </> : null}
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}
    </section>
  );
}

function TranslationFields({ translations, options, onChange }: { translations: Translation[]; options: ReturnType<typeof getTranslationLocaleOptions>; onChange: (items: Translation[]) => void }) {
  if (options.length === 0) return null;
  return <details className="border-t border-stone-200 pt-3 sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold">多語名稱</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{options.map((option) => { const current = translations.find((item) => item.locale === option.locale)?.name ?? ""; return <label key={option.locale} className="text-sm font-medium text-stone-700">{option.label}<input type="text" maxLength={120} value={current} onChange={(event) => { const next = translations.filter((item) => item.locale !== option.locale); if (event.target.value) next.push({ locale: option.locale, name: event.target.value }); onChange(next); }} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>; })}</div></details>;
}

function Editor({ title, onClose, dialogRef, errorMessage, wide = false, children }: { title: string; onClose: () => void; dialogRef: React.RefObject<HTMLElement | null>; errorMessage: string; wide?: boolean; children: React.ReactNode }) {
  return <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4"><section ref={dialogRef} role="dialog" aria-modal="true" aria-label={title} className={`my-auto w-full rounded-lg bg-white p-5 shadow-xl ${wide ? "max-w-2xl" : "max-w-md"}`}><div className="mb-4 flex items-center justify-between gap-3"><h2 className="text-lg font-semibold">{title}</h2><IconButton label="關閉" onClick={onClose}><X className="h-4 w-4" /></IconButton></div>{errorMessage ? <p role="alert" className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</p> : null}{children}</section></div>;
}

function IconButton({ label, danger = false, onClick, children }: { label: string; danger?: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} onClick={onClick} className={`grid h-10 w-10 shrink-0 place-items-center rounded-md hover:bg-stone-100 ${danger ? "text-red-700" : "text-stone-600"}`}>{children}</button>;
}
function TextField({ label, fieldKey, error, value, onChange, wide = false }: { label: string; fieldKey?: string; error?: string; value: string; onChange: (value: string) => void; wide?: boolean }) {
  const errorId = fieldKey ? `product-note-${fieldKey}-error` : undefined;
  return <label className={`text-sm font-medium text-stone-700 ${wide ? "sm:col-span-2" : ""}`}>{label}<input aria-label={label} type="text" required maxLength={80} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />{error && errorId ? <span id={errorId} className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}
function NumberField({ label, fieldKey, error, value, min = 0, max = 10_000, onChange }: { label: string; fieldKey?: string; error?: string; value: number; min?: number; max?: number; onChange: (value: number) => void }) {
  const errorId = fieldKey ? `product-note-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<input aria-label={label} required type="number" min={min} max={max} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />{error && errorId ? <span id={errorId} className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}
function SignedNumberField({ label, fieldKey, error, value, onChange }: { label: string; fieldKey?: string; error?: string; value: number; onChange: (value: number) => void }) {
  const errorId = fieldKey ? `product-note-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<input aria-label={label} required type="number" min={-10_000_000} max={10_000_000} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(Number(event.target.value))} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />{error && errorId ? <span id={errorId} className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}
function OptionalNumberField({ label, fieldKey, error, value, min = 1, onChange }: { label: string; fieldKey?: string; error?: string; value: number | null; min?: number; onChange: (value: number | null) => void }) {
  const errorId = fieldKey ? `product-note-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<input aria-label={label} type="number" min={min} max={20} placeholder="不限" value={value ?? ""} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />{error && errorId ? <span id={errorId} className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}
function SelectField({ label, fieldKey, error, value, options, onChange }: { label: string; fieldKey?: string; error?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const errorId = fieldKey ? `product-note-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<select aria-label={label} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{error && errorId ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-9 items-center gap-2 text-sm font-medium text-stone-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
function SubmitButton({ busy }: { busy: boolean }) {
  return <button disabled={busy} type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"><Check className="h-4 w-4" />儲存</button>;
}
