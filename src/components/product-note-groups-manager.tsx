"use client";

import { type FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, Download, Eye, EyeOff, MessageSquareText, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { csrfFormHeaders, csrfHeaders } from "@/lib/csrf-client";
import {
  getTranslationLocaleOptions,
  type TranslationLocale,
} from "@/lib/enabled-locales";
import { formatMoney } from "@/lib/money";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
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
type AttachDialogDraft = {
  noteGroupId: string;
  query: string;
  reusableNoteIds: string[];
};
type ProductNoteImportPreview = {
  file: File;
  summary: {
    reusableNoteCount: number;
    groupCount: number;
    optionCount: number;
    assignmentCount: number;
    reusableNoteCreateCount: number;
    reusableNoteUpdateCount: number;
    groupCreateCount: number;
    groupUpdateCount: number;
  };
  previewReusableNotes: ProductNoteImportPreviewItem[];
  previewGroups: Array<ProductNoteImportPreviewItem & { productCount: number; optionCount: number }>;
};
type ProductNoteImportPreviewItem = {
  name: string;
  changeType: "CREATE" | "UPDATE";
  changes: Array<{ field: string; before: string; after: string }>;
  additionalChangeCount: number;
};
const MAX_REUSABLE_NOTES_PER_BATCH = 100;

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
  const { locale, m, label } = useMerchantMessages();
  const [groups, setGroups] = useState(initialNoteGroups);
  const [reusableNotes, setReusableNotes] = useState(initialReusableNotes);
  const [activeTab, setActiveTab] = useState<"NOTES" | "GROUPS">("NOTES");
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [optionDraft, setOptionDraft] = useState<OptionDraft | null>(null);
  const [reusableNoteDraft, setReusableNoteDraft] = useState<ReusableNoteDraft | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [collapsedGroupIds, setCollapsedGroupIds] = useState<Set<string>>(() => new Set());
  const [attachDialog, setAttachDialog] = useState<AttachDialogDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [editorMessage, setEditorMessage] = useState("");
  const [editorFieldErrors, setEditorFieldErrors] = useState<Record<string, string>>({});
  const [importPreview, setImportPreview] = useState<ProductNoteImportPreview | null>(null);
  const [importError, setImportError] = useState("");
  const editorRef = useRef<HTMLElement>(null);
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
  const allGroupsExpanded = sortedGroups.length > 0
    && sortedGroups.every((group) => !collapsedGroupIds.has(group.id));
  const attachGroup = attachDialog
    ? groups.find((group) => group.id === attachDialog.noteGroupId) ?? null
    : null;
  const availableReusableNotes = useMemo(() => {
    if (!attachGroup) return [];
    const linkedReusableNoteIds = new Set(
      attachGroup.options.flatMap((option) => option.reusableNoteId ? [option.reusableNoteId] : []),
    );
    return sortedReusableNotes.filter((note) => !linkedReusableNoteIds.has(note.id));
  }, [attachGroup, sortedReusableNotes]);
  const filteredReusableNotes = useMemo(() => {
    const query = attachDialog?.query.trim().normalize("NFKC").toLocaleLowerCase("zh-TW") ?? "";
    if (!query) return availableReusableNotes;
    return availableReusableNotes.filter((note) => (
      [note.name, ...note.translations.map((translation) => translation.name)]
        .join(" ")
        .normalize("NFKC")
        .toLocaleLowerCase("zh-TW")
        .includes(query)
    ));
  }, [attachDialog?.query, availableReusableNotes]);

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
        const errorMessage = typeof payload.error === "string"
          ? label(payload.error)
          : m("目前無法更新註記群組。");
        if (inEditor) {
          const nextFieldErrors = Object.fromEntries(
            Object.entries(payload.fieldErrors ?? {}).map(([field, error]) => [field, label(error)]),
          );
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
      const errorMessage = error instanceof Error ? label(error.message) : m("目前無法更新註記群組。");
      if (inEditor) setEditorMessage(errorMessage);
      else setMessage(errorMessage);
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function exportProductNotes() {
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/product-notes/export`, {
        headers: { accept: "application/json" },
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(typeof payload.error === "string" ? label(payload.error) : m("商品註記匯出失敗，請稍後再試。"));
      }
      const objectUrl = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = productNoteExportFileName(response.headers.get("content-disposition"));
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setMessage(m("商品註記已匯出。"));
    } catch (error) {
      setMessage(error instanceof Error ? label(error.message) : m("商品註記匯出失敗，請稍後再試。"));
    } finally {
      setBusy(false);
    }
  }

  async function previewProductNoteImport(file: File) {
    const form = new FormData();
    form.set("productNotes", file);
    form.set("mode", "PREVIEW");
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/product-notes/import`, {
        method: "POST",
        headers: csrfFormHeaders(),
        body: form,
      });
      const payload = await response.json() as Omit<ProductNoteImportPreview, "file"> & { error?: string };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("註記匯入預覽失敗。"));
      setImportPreview({
        file,
        summary: payload.summary,
        previewReusableNotes: payload.previewReusableNotes,
        previewGroups: payload.previewGroups,
      });
      setImportError("");
    } catch (error) {
      setMessage(error instanceof Error ? label(error.message) : m("註記匯入預覽失敗。"));
    } finally {
      setBusy(false);
    }
  }

  async function applyProductNoteImport() {
    if (!importPreview) return;
    const form = new FormData();
    form.set("productNotes", importPreview.file);
    form.set("mode", "APPLY");
    setBusy(true);
    setMessage("");
    setImportError("");
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/product-notes/import`, {
        method: "POST",
        headers: csrfFormHeaders(),
        body: form,
      });
      const payload = await response.json() as {
        error?: string;
        warning?: string;
        noteGroups?: ProductNoteGroupView[];
        reusableNotes?: ReusableProductNoteView[];
        summary: ProductNoteImportPreview["summary"];
      };
      if (!response.ok) throw new Error(typeof payload.error === "string" ? label(payload.error) : m("註記匯入失敗。"));
      if (payload.noteGroups && payload.reusableNotes) {
        setGroups(payload.noteGroups);
        setReusableNotes(payload.reusableNotes);
        onChange?.(payload.noteGroups, payload.reusableNotes);
      }
      setImportPreview(null);
      setMessage(typeof payload.warning === "string"
        ? label(payload.warning)
        : m("已匯入 {reusableNoteCount} 個共用註記、{groupCount} 個群組與 {optionCount} 個群組註記。", {
          reusableNoteCount: payload.summary.reusableNoteCount,
          groupCount: payload.summary.groupCount,
          optionCount: payload.summary.optionCount,
        }));
    } catch (error) {
      setImportError(error instanceof Error ? label(error.message) : m("註記匯入失敗。"));
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
    if (await runCommand(command, groupDraft.id ? m("註記群組已更新。") : m("註記群組已新增。"), true)) setGroupDraft(null);
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
    if (await runCommand(command, optionDraft.id ? m("註記選項已更新。") : m("註記選項已新增。"), true)) setOptionDraft(null);
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
    if (await runCommand(command, reusableNoteDraft.id ? m("共用單一註記已更新，所有群組已同步。") : m("共用單一註記已新增。"), true)) {
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
    }, note.isActive ? m("共用單一註記已停用，所有群組已同步。") : m("共用單一註記已啟用，所有群組已同步。"));
  }

  async function deleteReusableNote(note: ReusableProductNoteView) {
    if (!window.confirm(m("確定刪除共用單一註記「{noteName}」？仍在群組中使用時系統會拒絕刪除。", { noteName: note.name }))) return;
    await runCommand(
      { operation: "DELETE_REUSABLE_NOTE", reusableNoteId: note.id },
      m("共用單一註記已刪除。"),
    );
  }

  function toggleAllGroups() {
    setCollapsedGroupIds(allGroupsExpanded
      ? new Set(sortedGroups.map((group) => group.id))
      : new Set());
  }

  function updateGroupDisclosure(groupId: string, isOpen: boolean) {
    setCollapsedGroupIds((current) => {
      const next = new Set(current);
      if (isOpen) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }

  function openAttachDialog(group: ProductNoteGroupView) {
    clearEditorFeedback();
    setAttachDialog({ noteGroupId: group.id, query: "", reusableNoteIds: [] });
  }

  function closeAttachDialog() {
    clearEditorFeedback();
    setAttachDialog(null);
  }

  function updateAttachSelection(reusableNoteId: string, checked: boolean) {
    clearEditorField("reusableNoteIds");
    setEditorMessage("");
    setAttachDialog((current) => {
      if (!current) return current;
      const selected = current.reusableNoteIds;
      if (checked && (selected.includes(reusableNoteId) || selected.length >= MAX_REUSABLE_NOTES_PER_BATCH)) {
        return current;
      }
      return {
        ...current,
        reusableNoteIds: checked
          ? [...selected, reusableNoteId]
          : selected.filter((id) => id !== reusableNoteId),
      };
    });
  }

  async function attachReusableNotes() {
    if (!attachDialog || !attachGroup) return;
    const reusableNoteIds = attachDialog.reusableNoteIds;
    if (reusableNoteIds.length === 0) {
      const error = m("請至少選擇一個要加入群組的共用單一註記。");
      setEditorFieldErrors({ reusableNoteIds: error });
      requestAnimationFrame(() => {
        editorRef.current
          ?.querySelector<HTMLElement>('[data-field-key="reusableNoteIds"]')
          ?.focus();
      });
      return;
    }
    const attached = await runCommand(
      { operation: "ATTACH_REUSABLE_NOTES", noteGroupId: attachGroup.id, reusableNoteIds },
      m("已將 {count} 個共用單一註記加入群組。", { count: reusableNoteIds.length }),
      true,
    );
    if (attached) setAttachDialog(null);
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
    }, group.isActive ? m("註記群組已停用。") : m("註記群組已啟用。"));
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
    }, option.isActive ? m("註記選項已停用。") : m("註記選項已啟用。"));
  }

  async function deleteGroup(group: ProductNoteGroupView) {
    if (!window.confirm(m("確定刪除註記群組「{groupName}」？歷史訂單會保留原始快照。", { groupName: group.name }))) return;
    await runCommand({ operation: "DELETE_NOTE_GROUP", noteGroupId: group.id }, m("註記群組已刪除。"));
  }

  async function deleteOption(option: NoteOption) {
    const action = option.reusableNoteId ? m("從此群組移除") : m("刪除");
    if (!window.confirm(m("確定{action}註記選項「{optionName}」？歷史訂單會保留原始快照。", { action, optionName: option.name }))) return;
    await runCommand(
      { operation: "DELETE_NOTE_OPTION", noteOptionId: option.id },
      option.reusableNoteId ? m("共用註記已從群組移除。") : m("註記選項已刪除。"),
    );
  }

  async function moveReusableNote(index: number, direction: -1 | 1) {
    const reusableNoteIds = moveOrderedId(sortedReusableNotes.map((note) => note.id), index, direction);
    if (!reusableNoteIds) return;
    await runCommand({ operation: "REORDER_REUSABLE_NOTES", reusableNoteIds }, label("共用註記排序已更新。"));
  }

  async function moveNoteGroup(index: number, direction: -1 | 1) {
    const noteGroupIds = moveOrderedId(sortedGroups.map((group) => group.id), index, direction);
    if (!noteGroupIds) return;
    await runCommand({ operation: "REORDER_NOTE_GROUPS", noteGroupIds }, label("註記群組排序已更新。"));
  }

  async function moveNoteOption(noteGroupId: string, options: NoteOption[], index: number, direction: -1 | 1) {
    const noteOptionIds = moveOrderedId(options.map((option) => option.id), index, direction);
    if (!noteOptionIds) return;
    await runCommand({ operation: "REORDER_NOTE_OPTIONS", noteGroupId, noteOptionIds }, label("註記選項排序已更新。"));
  }

  return (
    <section aria-labelledby="product-notes-heading" className="mt-10 border-t border-stone-200 pt-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-semibold text-teal-800">{label("商品客製化")}</p>
          <h2 id="product-notes-heading" className="mt-1 text-2xl font-semibold">{label("商品註記設定")}</h2>
        </div>
        <button
          type="button"
          data-testid="product-note-settings-toggle"
          aria-controls="product-note-settings-content"
          aria-expanded={settingsExpanded}
          onClick={() => setSettingsExpanded((current) => !current)}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold sm:w-auto"
        >
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${settingsExpanded ? "rotate-180" : ""}`} />
          {settingsExpanded ? label("摺疊商品註記設定") : label("展開商品註記設定")}
        </button>
      </div>

      <div id="product-note-settings-content" hidden={!settingsExpanded}>
        <div className="mt-4 flex flex-wrap gap-2 sm:justify-end">
          <button
            type="button"
            disabled={busy}
            onClick={() => void exportProductNotes()}
            className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"
          >
            <Download className="h-4 w-4" />{label("匯出 JSON")}
          </button>
          <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-700 focus-within:ring-offset-2">
            <Upload className="h-4 w-4" />{label("匯入 JSON")}
            <input
              type="file"
              accept=".json,application/json"
              className="sr-only"
              disabled={busy}
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void previewProductNoteImport(file);
                event.currentTarget.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => activeTab === "NOTES"
              ? setReusableNoteDraft({ name: "", priceDelta: 0, sortOrder: nextProductNoteSortOrder(reusableNotes), isActive: true, translations: [] })
              : setGroupDraft({ name: "", selectionMode: "MULTIPLE", isRequired: false, minSelections: 0, maxSelections: null, sortOrder: nextProductNoteSortOrder(groups), isActive: true, translations: [], productIds: [] })}
            className="inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white"
          >
            <Plus className="h-4 w-4" />{activeTab === "NOTES" ? label("新增單一註記") : label("新增群組")}
          </button>
        </div>

      <div role="tablist" aria-label={label("商品註記設定")} className="mt-5 flex gap-1 border-b border-stone-200">
        <button type="button" role="tab" aria-selected={activeTab === "NOTES"} onClick={() => setActiveTab("NOTES")} className={`min-h-11 border-b-2 px-4 text-sm font-semibold ${activeTab === "NOTES" ? "border-teal-700 text-teal-800" : "border-transparent text-stone-500"}`}>{label("所有單一註記")}</button>
        <button type="button" role="tab" aria-selected={activeTab === "GROUPS"} onClick={() => setActiveTab("GROUPS")} className={`min-h-11 border-b-2 px-4 text-sm font-semibold ${activeTab === "GROUPS" ? "border-teal-700 text-teal-800" : "border-transparent text-stone-500"}`}>{label("註記群組")}</button>
      </div>
      {message ? <p role="status" className="mt-4 text-sm font-medium text-stone-700">{message}</p> : null}
      {activeTab === "GROUPS" ? (
        <div className="mt-4 flex justify-end">
          <button
            type="button"
            data-testid="product-note-groups-toggle-all"
            aria-controls="product-note-groups-list"
            aria-expanded={allGroupsExpanded}
            disabled={sortedGroups.length === 0}
            onClick={toggleAllGroups}
            className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50 sm:w-auto"
          >
            <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${allGroupsExpanded ? "rotate-180" : ""}`} />
            {allGroupsExpanded ? label("收合全部註記群組") : label("展開全部註記群組")}
          </button>
        </div>
      ) : null}
      {activeTab === "NOTES" ? (
        <div role="tabpanel" className="mt-5 divide-y divide-stone-200 border-y border-stone-200">
          {sortedReusableNotes.map((note, noteIndex) => (
            <div key={note.id} className="grid min-h-16 gap-2 py-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <div>
                <div className="flex flex-wrap items-center gap-2"><strong>{note.name}</strong>{!note.isActive ? <span className="text-xs text-red-700">{label("已停用")}</span> : null}</div>
                <p className="mt-1 text-xs text-stone-500">{m("{price} · 排序 {sortOrder} · 已加入 {count} 個群組", { price: note.priceDelta === 0 ? label("不加價") : `${note.priceDelta > 0 ? "+" : ""}${formatMoney(note.priceDelta, currency, locale)}`, sortOrder: note.sortOrder, count: note.linkedOptionCount })}</p>
              </div>
              <div className="flex flex-wrap items-center justify-end">
                <IconButton disabled={busy || noteIndex === 0} label={m("將 {value0} 上移", { value0: note.name })} onClick={() => void moveReusableNote(noteIndex, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
                <IconButton disabled={busy || noteIndex === sortedReusableNotes.length - 1} label={m("將 {value0} 下移", { value0: note.name })} onClick={() => void moveReusableNote(noteIndex, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
                <IconButton label={m("編輯 {name}", { name: note.name })} onClick={() => setReusableNoteDraft({ id: note.id, name: note.name, priceDelta: note.priceDelta, sortOrder: note.sortOrder, isActive: note.isActive, translations: note.translations })}><Pencil className="h-4 w-4" /></IconButton>
                <IconButton label={m("{action} {name}", { action: note.isActive ? label("停用") : label("啟用"), name: note.name })} onClick={() => void toggleReusableNote(note)}>{note.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                <IconButton label={m("刪除 {name}", { name: note.name })} danger onClick={() => void deleteReusableNote(note)}><Trash2 className="h-4 w-4" /></IconButton>
              </div>
            </div>
          ))}
          {reusableNotes.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{label("尚未建立共用單一註記。")}</p> : null}
        </div>
      ) : (
        <div id="product-note-groups-list" role="tabpanel" className="mt-3 divide-y divide-stone-200 border-y border-stone-200">
          {sortedGroups.map((group, groupIndex) => {
            const assignedNames = group.assignments
              .map((assignment) => products.find((product) => product.id === assignment.productId)?.name)
              .filter((name): name is string => Boolean(name));
            const availableReusableNoteCount = sortedReusableNotes.filter(
              (note) => !group.options.some((option) => option.reusableNoteId === note.id),
            ).length;
            const sortedOptions = [...group.options].sort((left, right) => (
              left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW")
            ));
            return (
              <details
                key={group.id}
                open={!collapsedGroupIds.has(group.id)}
                onToggle={(event) => {
                  const isOpen = event.currentTarget.open;
                  updateGroupDisclosure(group.id, isOpen);
                }}
                className="group py-1"
              >
                <summary className="flex min-h-16 cursor-pointer list-none flex-wrap items-center gap-1 py-3 sm:gap-3 [&::-webkit-details-marker]:hidden">
                  <MessageSquareText className="h-4 w-4 shrink-0 text-teal-700" />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2"><strong>{group.name}</strong>{!group.isActive ? <span className="text-xs text-red-700">{label("已停用")}</span> : null}</div>
                    <p className="mt-1 truncate text-xs text-stone-500">{m("{selectionMode} · {required} · 最少 {min} 項 · 最多 {max} 項 · {count} 項商品", { selectionMode: group.selectionMode === "SINGLE" ? label("單選") : label("複選"), required: group.isRequired ? label("必選") : label("選填"), min: group.minSelections, max: group.maxSelections ?? label("不限"), count: assignedNames.length })}</p>
                  </div>
                  <div className="ml-auto flex w-full flex-wrap items-center justify-end pl-5 sm:w-auto sm:flex-nowrap sm:pl-0">
                    <IconButton disabled={busy || groupIndex === 0} label={m("將 {value0} 上移", { value0: group.name })} onClick={(event) => { event.preventDefault(); void moveNoteGroup(groupIndex, -1); }}><ArrowUp className="h-4 w-4" /></IconButton>
                    <IconButton disabled={busy || groupIndex === sortedGroups.length - 1} label={m("將 {value0} 下移", { value0: group.name })} onClick={(event) => { event.preventDefault(); void moveNoteGroup(groupIndex, 1); }}><ArrowDown className="h-4 w-4" /></IconButton>
                    <IconButton label={m("編輯 {name}", { name: group.name })} onClick={(event) => { event.preventDefault(); editGroup(group); }}><Pencil className="h-4 w-4" /></IconButton>
                    <IconButton label={m("{action} {name}", { action: group.isActive ? label("停用") : label("啟用"), name: group.name })} onClick={(event) => { event.preventDefault(); void toggleGroup(group); }}>{group.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton>
                    <IconButton label={m("刪除 {name}", { name: group.name })} danger onClick={(event) => { event.preventDefault(); void deleteGroup(group); }}><Trash2 className="h-4 w-4" /></IconButton>
                    <ChevronDown aria-hidden="true" className="h-4 w-4 shrink-0 text-stone-500 transition-transform group-open:rotate-180" />
                  </div>
                </summary>
                <div className="pb-4 pl-0 sm:pl-7">
                  <p className="mb-3 line-clamp-2 break-words text-xs text-stone-500">{assignedNames.length > 0 ? new Intl.ListFormat(locale, { style: "short", type: "conjunction" }).format(assignedNames) : label("尚未指派商品")}</p>
                  <div className="mb-3 grid gap-2 rounded-md bg-stone-50 p-3 sm:flex sm:items-center">
                    <button
                      type="button"
                      disabled={busy || availableReusableNoteCount === 0}
                      onClick={() => openAttachDialog(group)}
                      className="min-h-11 w-full rounded-md border border-teal-700 px-3 text-sm font-semibold text-teal-800 disabled:opacity-50 sm:w-auto"
                    >
                      {availableReusableNoteCount > 0
                        ? m("加入既有共用註記（{count}）", { count: availableReusableNoteCount })
                        : label("所有共用註記皆已加入")}
                    </button>
                    <button type="button" onClick={() => setOptionDraft({ noteGroupId: group.id, reusableNoteId: null, name: "", priceDelta: 0, sortOrder: nextProductNoteSortOrder(group.options), isActive: true, translations: [] })} className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold sm:ml-auto sm:w-auto"><Plus className="h-4 w-4" />{label("新增群組專用註記")}</button>
                  </div>
                  <div className="divide-y divide-stone-100">
                    {sortedOptions.map((option, optionIndex) => (
                      <div key={option.id} className="grid min-h-12 gap-2 py-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
                        <div><span className="text-sm font-medium">{option.name}</span><span className="ml-2 text-xs text-stone-500">{option.priceDelta === 0 ? label("不加價") : `${option.priceDelta > 0 ? "+" : ""}${formatMoney(option.priceDelta, currency, locale)}`}</span><span className="ml-2 text-xs text-teal-700">{option.reusableNoteId ? label("共用單一註記") : label("群組專用")}</span>{!option.isActive ? <span className="ml-2 text-xs text-red-700">{label("已停用")}</span> : null}</div>
                        <div className="flex flex-wrap items-center justify-end">
                          <IconButton disabled={busy || optionIndex === 0} label={m("將 {value0} 上移", { value0: option.name })} onClick={() => void moveNoteOption(group.id, sortedOptions, optionIndex, -1)}><ArrowUp className="h-4 w-4" /></IconButton>
                          <IconButton disabled={busy || optionIndex === sortedOptions.length - 1} label={m("將 {value0} 下移", { value0: option.name })} onClick={() => void moveNoteOption(group.id, sortedOptions, optionIndex, 1)}><ArrowDown className="h-4 w-4" /></IconButton>
                          <IconButton label={m("{action} {name}", { action: option.reusableNoteId ? label("調整排序") : label("編輯"), name: option.name })} onClick={() => setOptionDraft({ ...option, noteGroupId: group.id })}><Pencil className="h-4 w-4" /></IconButton>
                          {!option.reusableNoteId ? <IconButton label={m("{action} {name}", { action: option.isActive ? label("停用") : label("啟用"), name: option.name })} onClick={() => void toggleOption(option)}>{option.isActive ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</IconButton> : null}
                          <IconButton label={m("{action} {name}", { action: option.reusableNoteId ? label("從群組移除") : label("刪除"), name: option.name })} danger onClick={() => void deleteOption(option)}><Trash2 className="h-4 w-4" /></IconButton>
                        </div>
                      </div>
                    ))}
                    {group.options.length === 0 ? <p className="py-4 text-sm text-stone-500">{label("尚未建立註記選項。")}</p> : null}
                  </div>
                </div>
              </details>
            );
          })}
          {groups.length === 0 ? <p className="py-10 text-center text-sm text-stone-500">{label("尚未建立商品註記群組。")}</p> : null}
        </div>
      )}

      {attachDialog && attachGroup ? (
        <Editor
          title={m("將共用註記加入「{groupName}」", { groupName: attachGroup.name })}
          onClose={closeAttachDialog}
          dialogRef={editorRef}
          errorMessage={editorMessage}
          wide
          constrained
          closeDisabled={busy}
        >
          <div className="flex min-h-0 flex-1 flex-col">
            <p className="shrink-0 text-sm text-stone-600">{label("搜尋並勾選要加入此群組的共用註記；已加入的註記不會重複顯示。")}</p>
            <label className="mt-3 shrink-0 text-sm font-medium text-stone-700">
              {label("搜尋共用註記")}
              <span className="relative mt-1 block">
                <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-stone-500" />
                <input
                  data-dialog-initial-focus
                  type="search"
                  value={attachDialog.query}
                  maxLength={120}
                  onChange={(event) => setAttachDialog((current) => current ? { ...current, query: event.target.value } : current)}
                  placeholder={label("輸入註記名稱")}
                  className="min-h-11 w-full rounded-md border border-stone-300 py-2 pl-9 pr-3"
                />
              </span>
            </label>
            <fieldset
              tabIndex={-1}
              data-testid="product-note-attach-list"
              data-field-key="reusableNoteIds"
              aria-invalid={Boolean(editorFieldErrors.reusableNoteIds)}
              aria-describedby={editorFieldErrors.reusableNoteIds ? "product-note-attach-reusableNoteIds-error" : undefined}
              className={`mt-3 min-h-0 flex-1 touch-pan-y overflow-y-auto overscroll-contain rounded-md border p-2 ${editorFieldErrors.reusableNoteIds ? "border-red-500 ring-1 ring-red-200" : "border-stone-300"}`}
            >
              <legend className="sr-only">{label("選擇共用註記")}</legend>
              {filteredReusableNotes.map((note) => {
                const selected = attachDialog.reusableNoteIds.includes(note.id);
                return (
                  <label key={note.id} className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md px-2 py-2 text-sm hover:bg-stone-50">
                    <input
                      type="checkbox"
                      aria-label={note.name}
                      checked={selected}
                      disabled={busy || (attachDialog.reusableNoteIds.length >= MAX_REUSABLE_NOTES_PER_BATCH && !selected)}
                      onChange={(event) => updateAttachSelection(note.id, event.target.checked)}
                      className="h-5 w-5 shrink-0"
                    />
                    <span className="min-w-0 flex-1 break-words font-medium">{note.name}</span>
                    <span className="shrink-0 text-xs text-stone-500">{note.priceDelta === 0 ? label("不加價") : `${note.priceDelta > 0 ? "+" : ""}${formatMoney(note.priceDelta, currency, locale)}`}</span>
                    {!note.isActive ? <span className="shrink-0 text-xs text-red-700">{label("已停用")}</span> : null}
                  </label>
                );
              })}
              {filteredReusableNotes.length === 0 ? <p className="px-2 py-8 text-center text-sm text-stone-500">{label("找不到符合的共用註記。")}</p> : null}
            </fieldset>
            <div data-testid="product-note-attach-actions" className="mt-3 shrink-0 border-t border-stone-200 bg-white pt-3">
              <p aria-live="polite" className="text-xs text-stone-500">{m("已選擇 {count} 個註記（單次最多 {max} 個）", { count: attachDialog.reusableNoteIds.length, max: MAX_REUSABLE_NOTES_PER_BATCH })}</p>
              {editorFieldErrors.reusableNoteIds ? <span id="product-note-attach-reusableNoteIds-error" role="alert" className="mt-1 block text-xs text-red-700">{editorFieldErrors.reusableNoteIds}</span> : null}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:flex sm:justify-end">
                <button type="button" disabled={busy} onClick={closeAttachDialog} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold disabled:opacity-50">{label("取消")}</button>
                <button type="button" disabled={busy || availableReusableNotes.length === 0} onClick={() => void attachReusableNotes()} className="min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? label("加入中…") : label("加入群組")}</button>
              </div>
            </div>
          </div>
        </Editor>
      ) : null}

      {groupDraft ? (
        <Editor title={groupDraft.id ? label("編輯註記群組") : label("新增註記群組")} onClose={() => { clearEditorFeedback(); setGroupDraft(null); }} dialogRef={editorRef} errorMessage={editorMessage} wide>
          <form noValidate onSubmit={saveGroup} className="grid gap-4 sm:grid-cols-2">
            <TextField label={label("群組名稱")} fieldKey="name" error={editorFieldErrors.name} value={groupDraft.name} onChange={(name) => { clearEditorField("name"); setGroupDraft({ ...groupDraft, name }); }} wide />
            <SelectField label={label("選取方式")} value={groupDraft.selectionMode} options={[{ value: "SINGLE", label: label("單選") }, { value: "MULTIPLE", label: label("複選") }]} onChange={(selectionMode) => setGroupDraft({ ...groupDraft, selectionMode: selectionMode as GroupDraft["selectionMode"], minSelections: selectionMode === "SINGLE" ? Math.min(groupDraft.minSelections, 1) : groupDraft.minSelections, maxSelections: selectionMode === "SINGLE" ? 1 : null })} />
            <NumberField label={label("最少選取數")} fieldKey="minSelections" error={editorFieldErrors.minSelections} value={groupDraft.minSelections} min={0} max={groupDraft.selectionMode === "SINGLE" ? 1 : 20} onChange={(minSelections) => { clearEditorField("minSelections"); setGroupDraft({ ...groupDraft, minSelections, isRequired: minSelections > 0 }); }} />
            {groupDraft.selectionMode === "MULTIPLE" ? <OptionalNumberField label={label("最多選取數")} fieldKey="maxSelections" error={editorFieldErrors.maxSelections} value={groupDraft.maxSelections} min={1} onChange={(maxSelections) => { clearEditorField("maxSelections"); setGroupDraft({ ...groupDraft, maxSelections }); }} /> : <div />}
            <NumberField label={label("排序")} fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={groupDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setGroupDraft({ ...groupDraft, sortOrder }); }} />
            <div className="grid content-center gap-2"><CheckField label={label("顧客必須選擇")} checked={groupDraft.isRequired} onChange={(isRequired) => setGroupDraft({ ...groupDraft, isRequired, minSelections: isRequired ? Math.max(1, groupDraft.minSelections) : 0 })} /><CheckField label={label("啟用群組")} checked={groupDraft.isActive} onChange={(isActive) => setGroupDraft({ ...groupDraft, isActive })} /></div>
            <fieldset tabIndex={-1} data-field-key="productIds" aria-invalid={Boolean(editorFieldErrors.productIds)} aria-describedby={editorFieldErrors.productIds ? "product-note-productIds-error" : undefined} className={`sm:col-span-2 rounded-md ${editorFieldErrors.productIds ? "border border-red-500 bg-red-50 p-2" : ""}`}><legend className="text-sm font-semibold text-stone-700">{label("指派商品")}</legend><div className="mt-2 max-h-56 overflow-y-auto border-y border-stone-200">{productsByCategory.map(([categoryName, categoryProducts]) => <details key={categoryName} open><summary className="cursor-pointer py-2 text-sm font-semibold">{categoryName}</summary><div className="pb-2 pl-3">{categoryProducts.map((product) => <label key={product.id} className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={groupDraft.productIds.includes(product.id)} onChange={(event) => { clearEditorField("productIds"); setGroupDraft({ ...groupDraft, productIds: event.target.checked ? [...groupDraft.productIds, product.id] : groupDraft.productIds.filter((id) => id !== product.id) }); }} />{product.name}{!product.isActive ? <span className="text-xs text-stone-500">{label("（已停用）")}</span> : null}</label>)}</div></details>)}</div>{editorFieldErrors.productIds ? <span id="product-note-productIds-error" role="alert" className="mt-1 block text-xs text-red-700">{editorFieldErrors.productIds}</span> : null}</fieldset>
            <TranslationFields translations={groupDraft.translations} options={translationOptions} onChange={(translations) => setGroupDraft({ ...groupDraft, translations })} />
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {reusableNoteDraft ? (
        <Editor title={reusableNoteDraft.id ? label("編輯共用單一註記") : label("新增共用單一註記")} onClose={() => { clearEditorFeedback(); setReusableNoteDraft(null); }} dialogRef={editorRef} errorMessage={editorMessage}>
          <form noValidate onSubmit={saveReusableNote} className="grid gap-4">
            <TextField label={label("註記名稱")} fieldKey="name" error={editorFieldErrors.name} value={reusableNoteDraft.name} onChange={(name) => { clearEditorField("name"); setReusableNoteDraft({ ...reusableNoteDraft, name }); }} />
            <SignedNumberField label={label("價格調整")} fieldKey="priceDelta" error={editorFieldErrors.priceDelta} value={reusableNoteDraft.priceDelta} onChange={(priceDelta) => { clearEditorField("priceDelta"); setReusableNoteDraft({ ...reusableNoteDraft, priceDelta }); }} />
            <NumberField label={label("排序")} fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={reusableNoteDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setReusableNoteDraft({ ...reusableNoteDraft, sortOrder }); }} />
            <CheckField label={label("啟用註記")} checked={reusableNoteDraft.isActive} onChange={(isActive) => setReusableNoteDraft({ ...reusableNoteDraft, isActive })} />
            <TranslationFields translations={reusableNoteDraft.translations} options={translationOptions} onChange={(translations) => setReusableNoteDraft({ ...reusableNoteDraft, translations })} />
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {optionDraft ? (
        <Editor title={optionDraft.reusableNoteId ? label("調整群組內排序") : optionDraft.id ? label("編輯群組專用註記") : label("新增群組專用註記")} onClose={() => { clearEditorFeedback(); setOptionDraft(null); }} dialogRef={editorRef} errorMessage={editorMessage}>
          <form noValidate onSubmit={saveOption} className="grid gap-4">
            {optionDraft.reusableNoteId ? <p className="text-sm text-stone-600">{m("「{optionName}」的名稱、價差、啟用狀態與翻譯由共用單一註記同步管理；此處只調整它在本群組內的排序。", { optionName: optionDraft.name })}</p> : <>
              <TextField label={label("註記名稱")} fieldKey="name" error={editorFieldErrors.name} value={optionDraft.name} onChange={(name) => { clearEditorField("name"); setOptionDraft({ ...optionDraft, name }); }} />
              <SignedNumberField label={label("價格調整")} fieldKey="priceDelta" error={editorFieldErrors.priceDelta} value={optionDraft.priceDelta} onChange={(priceDelta) => { clearEditorField("priceDelta"); setOptionDraft({ ...optionDraft, priceDelta }); }} />
            </>}
            <NumberField label={label("排序")} fieldKey="sortOrder" error={editorFieldErrors.sortOrder} value={optionDraft.sortOrder} onChange={(sortOrder) => { clearEditorField("sortOrder"); setOptionDraft({ ...optionDraft, sortOrder }); }} />
            {!optionDraft.reusableNoteId ? <>
              <CheckField label={label("啟用選項")} checked={optionDraft.isActive} onChange={(isActive) => setOptionDraft({ ...optionDraft, isActive })} />
              <TranslationFields translations={optionDraft.translations} options={translationOptions} onChange={(translations) => setOptionDraft({ ...optionDraft, translations })} />
            </> : null}
            <SubmitButton busy={busy} />
          </form>
        </Editor>
      ) : null}

      {importPreview ? (
        <Editor
          title={label("確認匯入商品註記")}
          onClose={() => { setImportError(""); setImportPreview(null); }}
          dialogRef={editorRef}
          errorMessage={importError}
          wide
        >
          <p className="text-sm text-stone-600">{label("匯入採安全合併：依名稱新增或更新資料，不會刪除檔案中未列出的既有註記、翻譯、群組選項或商品指派。商品指派先以原商品 ID 對應，跨商家時再以唯一商品名稱對應。")}</p>
          <p className="mt-2 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900"><strong>{label("同名資料會被更新：")}</strong>{label("共用註記會覆寫價格調整、排序與啟用狀態；註記群組會覆寫選取規則、排序與啟用狀態。檔案中列出的翻譯、商品指派及群組註記也會新增或更新，實際差異如下。")}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 rounded-md bg-stone-50 p-4 text-sm sm:grid-cols-4">
            <div><dt className="text-stone-500">{label("共用註記")}</dt><dd className="mt-1 text-lg font-semibold">{importPreview.summary.reusableNoteCount}</dd><dd className="text-xs text-stone-500">{m("新增 {createCount} · 更新 {updateCount}", { createCount: importPreview.summary.reusableNoteCreateCount, updateCount: importPreview.summary.reusableNoteUpdateCount })}</dd></div>
            <div><dt className="text-stone-500">{label("註記群組")}</dt><dd className="mt-1 text-lg font-semibold">{importPreview.summary.groupCount}</dd><dd className="text-xs text-stone-500">{m("新增 {createCount} · 更新 {updateCount}", { createCount: importPreview.summary.groupCreateCount, updateCount: importPreview.summary.groupUpdateCount })}</dd></div>
            <div><dt className="text-stone-500">{label("群組註記")}</dt><dd className="mt-1 text-lg font-semibold">{importPreview.summary.optionCount}</dd></div>
            <div><dt className="text-stone-500">{label("商品指派")}</dt><dd className="mt-1 text-lg font-semibold">{importPreview.summary.assignmentCount}</dd></div>
          </dl>
          {importPreview.previewReusableNotes.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">{label("共用單一註記影響")}</h3>
              <div className="mt-2 max-h-48 overflow-y-auto border-y border-stone-200">
                {importPreview.previewReusableNotes.map((note) => (
                  <ImportPreviewRow key={note.name} item={note} />
                ))}
              </div>
            </div>
          ) : null}
          {importPreview.previewGroups.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-sm font-semibold">{label("註記群組影響")}</h3>
              <div className="mt-2 max-h-64 overflow-y-auto border-y border-stone-200">
                {importPreview.previewGroups.map((group) => (
                  <ImportPreviewRow key={group.name} item={group} meta={m("{optionCount} 個註記 · {productCount} 個商品", { optionCount: group.optionCount, productCount: group.productCount })} />
                ))}
              </div>
            </div>
          ) : null}
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" disabled={busy} onClick={() => { setImportError(""); setImportPreview(null); }} className="min-h-11 rounded-md border border-stone-300 px-4 text-sm font-semibold">{label("取消")}</button>
            <button type="button" disabled={busy} onClick={() => void applyProductNoteImport()} className="min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? label("匯入中…") : label("套用匯入")}</button>
          </div>
        </Editor>
      ) : null}
      </div>
    </section>
  );
}

function ImportPreviewRow({ item, meta }: { item: ProductNoteImportPreviewItem; meta?: string }) {
  const { m, label } = useMerchantMessages();
  const isCreate = item.changeType === "CREATE";
  return (
    <div className="border-b border-stone-100 py-3 text-sm last:border-b-0">
      <div className="flex flex-wrap items-center gap-2">
        <strong>{item.name}</strong>
        <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${isCreate ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"}`}>
          {isCreate ? label("新增") : label("更新")}
        </span>
        {meta ? <span className="ml-auto text-xs text-stone-500">{meta}</span> : null}
      </div>
      {isCreate ? <p className="mt-1 text-xs text-stone-500">{label("將建立新資料。")}</p> : item.changes.length > 0 ? (
        <ul className="mt-2 space-y-1 text-xs text-stone-600">
          {item.changes.map((change) => (
            <li key={`${change.field}-${change.before}-${change.after}`}><span className="font-medium text-stone-700">{localizeImportPreviewText(change.field, m, label)}</span>{label("：")}{localizeImportPreviewText(change.before, m, label)} → {localizeImportPreviewText(change.after, m, label)}</li>
          ))}
          {item.additionalChangeCount > 0 ? <li>{m("另有 {count} 項差異，套用前請確認匯入檔。", { count: item.additionalChangeCount })}</li> : null}
        </ul>
      ) : <p className="mt-1 text-xs text-stone-500">{label("同名資料已存在；檔案列出的覆寫欄位與目前設定相同。")}</p>}
    </div>
  );
}

function localizeImportPreviewText(
  value: string,
  m: ReturnType<typeof useMerchantMessages>["m"],
  label: ReturnType<typeof useMerchantMessages>["label"],
) {
  const translated = label(value);
  if (translated !== value) return translated;

  let match = value.match(/^翻譯（(.+)）$/u);
  if (match) return m("翻譯（{locale}）", { locale: match[1] });

  match = value.match(/^商品指派「(.+)」(排序|啟用狀態)?$/u);
  if (match) {
    if (match[2] === "排序") return m("商品指派「{name}」排序", { name: match[1] });
    if (match[2] === "啟用狀態") return m("商品指派「{name}」啟用狀態", { name: match[1] });
    return m("商品指派「{name}」", { name: match[1] });
  }

  match = value.match(/^群組註記「(.+)」翻譯（(.+)）$/u);
  if (match) return m("群組註記「{name}」翻譯（{locale}）", { name: match[1], locale: match[2] });

  match = value.match(/^群組註記「(.+)」(來源|價格調整|排序|啟用狀態)?$/u);
  if (match) {
    if (match[2] === "來源") return m("群組註記「{name}」來源", { name: match[1] });
    if (match[2] === "價格調整") return m("群組註記「{name}」價格調整", { name: match[1] });
    if (match[2] === "排序") return m("群組註記「{name}」排序", { name: match[1] });
    if (match[2] === "啟用狀態") return m("群組註記「{name}」啟用狀態", { name: match[1] });
    return m("群組註記「{name}」", { name: match[1] });
  }

  match = value.match(/^新增（排序 (\d+)、啟用）$/u);
  if (match) return m("新增（排序 {sortOrder}、啟用）", { sortOrder: match[1] });

  match = value.match(/^共用：(.+)$/u);
  if (match) return m("共用：{name}", { name: match[1] });

  return value;
}

function productNoteExportFileName(contentDisposition: string | null) {
  const headerName = contentDisposition?.match(/filename="?([^";]+)"?/iu)?.[1];
  const safeName = headerName?.trim().replace(/[^a-zA-Z0-9._-]/gu, "_");
  return safeName?.toLocaleLowerCase("en-US").endsWith(".json")
    ? safeName
    : "stallorder-product-notes.json";
}

function TranslationFields({ translations, options, onChange }: { translations: Translation[]; options: ReturnType<typeof getTranslationLocaleOptions>; onChange: (items: Translation[]) => void }) {
  const { label } = useMerchantMessages();
  if (options.length === 0) return null;
  return <details className="border-t border-stone-200 pt-3 sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold">{label("多語名稱")}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{options.map((option) => { const current = translations.find((item) => item.locale === option.locale)?.name ?? ""; return <label key={option.locale} className="text-sm font-medium text-stone-700">{label(option.label)}<input type="text" maxLength={120} value={current} onChange={(event) => { const next = translations.filter((item) => item.locale !== option.locale); if (event.target.value) next.push({ locale: option.locale, name: event.target.value }); onChange(next); }} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>; })}</div></details>;
}

function Editor({ title, onClose, dialogRef, errorMessage, wide = false, constrained = false, closeDisabled = false, children }: { title: string; onClose: () => void; dialogRef: React.RefObject<HTMLElement | null>; errorMessage: string; wide?: boolean; constrained?: boolean; closeDisabled?: boolean; children: React.ReactNode }) {
  const { label } = useMerchantMessages();
  const onCloseRef = useRef(onClose);
  const closeDisabledRef = useRef(closeDisabled);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    closeDisabledRef.current = closeDisabled;
  }, [closeDisabled]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const activeDialog: HTMLElement = dialog;
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousFocusFallback = previousFocus
      ?.closest("details")
      ?.querySelector<HTMLElement>(":scope > summary") ?? null;
    const bodyOverflow = document.body.style.overflow;
    const documentOverflow = document.documentElement.style.overflow;
    const focusableElements = () => [...activeDialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    )].filter((element) => element.getClientRects().length > 0);
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    (activeDialog.querySelector<HTMLElement>("[data-dialog-initial-focus]") ?? focusableElements()[0] ?? activeDialog).focus();

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        if (closeDisabledRef.current) return;
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
      if (previousFocus?.isConnected && !previousFocus.matches(":disabled") && previousFocus.getClientRects().length > 0) {
        previousFocus.focus();
      } else if (previousFocusFallback?.isConnected && previousFocusFallback.getClientRects().length > 0) {
        previousFocusFallback.focus();
      }
    };
  }, [dialogRef]);

  return (
    <div className={`fixed inset-0 z-50 grid place-items-center overscroll-contain bg-black/45 ${constrained ? "overflow-hidden p-2 sm:p-4" : "overflow-y-auto p-4"}`}>
      <section
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-auto w-full rounded-lg bg-white p-5 shadow-xl ${wide ? "max-w-2xl" : "max-w-md"} ${constrained ? "flex h-[calc(100dvh-1rem)] max-h-[52rem] flex-col overflow-hidden sm:h-[calc(100dvh-2rem)]" : ""}`}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3"><h2 className="min-w-0 break-words text-lg font-semibold">{title}</h2><IconButton label={label("關閉")} disabled={closeDisabled} onClick={onClose}><X className="h-4 w-4" /></IconButton></div>
        {errorMessage ? <p role="alert" className="mb-4 shrink-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</p> : null}
        {constrained ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
      </section>
    </div>
  );
}

function IconButton({ label, danger = false, disabled = false, onClick, children }: { label: string; danger?: boolean; disabled?: boolean; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return <button type="button" title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border bg-white hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 ${danger ? "border-red-200 text-red-700" : "border-stone-200 text-stone-600"}`}>{children}</button>;
}

function moveOrderedId(ids: string[], index: number, direction: -1 | 1) {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= ids.length || target >= ids.length) return null;
  const next = [...ids];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
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
  const { label: translateLabel } = useMerchantMessages();
  const errorId = fieldKey ? `product-note-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<input aria-label={label} type="number" min={min} max={20} placeholder={translateLabel("不限")} value={value ?? ""} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(event.target.value ? Number(event.target.value) : null)} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" />{error && errorId ? <span id={errorId} className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}
function SelectField({ label, fieldKey, error, value, options, onChange }: { label: string; fieldKey?: string; error?: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const errorId = fieldKey ? `product-note-${fieldKey}-error` : undefined;
  return <label className="text-sm font-medium text-stone-700">{label}<select aria-label={label} value={value} data-field-key={fieldKey} aria-invalid={Boolean(error)} aria-describedby={error && errorId ? errorId : undefined} onChange={(event) => onChange(event.target.value)} className="mt-1 w-full rounded-md border border-stone-300 bg-white px-3 py-2">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>{error && errorId ? <span id={errorId} role="alert" className="mt-1 block text-xs text-red-700">{error}</span> : null}</label>;
}
function CheckField({ label, checked, onChange }: { label: string; checked: boolean; onChange: (value: boolean) => void }) {
  return <label className="flex min-h-11 items-center gap-2 text-sm font-medium text-stone-700"><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />{label}</label>;
}
function SubmitButton({ busy }: { busy: boolean }) {
  const { label } = useMerchantMessages();
  return <button disabled={busy} type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"><Check className="h-4 w-4" />{label("儲存")}</button>;
}
