"use client";

import { type FormEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Check, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, EyeOff, Layers3, MessageSquareText, MoreHorizontal, Pencil, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { csrfFormHeaders, csrfHeaders } from "@/lib/csrf-client";
import {
  getTranslationLocaleOptions,
  type TranslationLocale,
} from "@/lib/enabled-locales";
import { formatMoney } from "@/lib/money";
import { useMerchantMessages } from "@/lib/messages/merchant-client";
import { nextProductNoteSortOrder } from "@/lib/product-note-sort";
import { SettingsFeedbackDialog, type SettingsFeedbackKind } from "@/components/settings-feedback-dialog";

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
type NoteActionTarget =
  | { kind: "REUSABLE_NOTE"; id: string }
  | { kind: "NOTE_GROUP"; id: string }
  | { kind: "NOTE_OPTION"; groupId: string; id: string };
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
  const [groupDraft, setGroupDraft] = useState<GroupDraft | null>(null);
  const [optionDraft, setOptionDraft] = useState<OptionDraft | null>(null);
  const [reusableNoteDraft, setReusableNoteDraft] = useState<ReusableNoteDraft | null>(null);
  const [settingsExpanded, setSettingsExpanded] = useState(true);
  const [reusableNoteNavigatorOpen, setReusableNoteNavigatorOpen] = useState(false);
  const [reusableNoteNavigatorQuery, setReusableNoteNavigatorQuery] = useState("");
  const [groupNavigatorOpen, setGroupNavigatorOpen] = useState(false);
  const [groupNavigatorGroupId, setGroupNavigatorGroupId] = useState<string | null>(null);
  const [groupNavigatorQuery, setGroupNavigatorQuery] = useState("");
  const [attachDialog, setAttachDialog] = useState<AttachDialogDraft | null>(null);
  const [noteActionTarget, setNoteActionTarget] = useState<NoteActionTarget | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<SettingsFeedbackKind>("success");
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
  const normalizedReusableNoteNavigatorQuery = reusableNoteNavigatorQuery.trim().normalize("NFKC").toLocaleLowerCase("zh-TW");
  const visibleNavigatorReusableNotes = normalizedReusableNoteNavigatorQuery
    ? sortedReusableNotes.filter((note) => (
        [note.name, ...note.translations.map((translation) => translation.name)]
          .join(" ")
          .normalize("NFKC")
          .toLocaleLowerCase("zh-TW")
          .includes(normalizedReusableNoteNavigatorQuery)
      ))
    : sortedReusableNotes;
  const productsByCategory = useMemo(() => {
    const categories = new Map<string, ProductRef[]>();
    products.forEach((product) => categories.set(product.categoryName, [...(categories.get(product.categoryName) ?? []), product]));
    return [...categories.entries()];
  }, [products]);
  const groupNavigatorGroup = groupNavigatorGroupId
    ? sortedGroups.find((group) => group.id === groupNavigatorGroupId) ?? null
    : null;
  const normalizedGroupNavigatorQuery = groupNavigatorQuery.trim().normalize("NFKC").toLocaleLowerCase("zh-TW");
  const visibleNavigatorGroups = normalizedGroupNavigatorQuery
    ? sortedGroups.filter((group) => (
        [group.name, ...group.translations.map((translation) => translation.name), ...group.options.map((option) => option.name)]
          .join(" ")
          .normalize("NFKC")
          .toLocaleLowerCase("zh-TW")
          .includes(normalizedGroupNavigatorQuery)
      ))
    : sortedGroups;
  const visibleNavigatorOptions = groupNavigatorGroup
    ? [...groupNavigatorGroup.options]
      .sort((left, right) => left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW"))
      .filter((option) => !normalizedGroupNavigatorQuery || (
        [option.name, ...option.translations.map((translation) => translation.name)]
          .join(" ")
          .normalize("NFKC")
          .toLocaleLowerCase("zh-TW")
          .includes(normalizedGroupNavigatorQuery)
      ))
    : [];
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
  const actionReusableNote = noteActionTarget?.kind === "REUSABLE_NOTE"
    ? sortedReusableNotes.find((note) => note.id === noteActionTarget.id) ?? null
    : null;
  const actionReusableNoteIndex = actionReusableNote
    ? sortedReusableNotes.findIndex((note) => note.id === actionReusableNote.id)
    : -1;
  const actionGroup = noteActionTarget?.kind === "NOTE_GROUP"
    ? sortedGroups.find((group) => group.id === noteActionTarget.id) ?? null
    : null;
  const actionGroupIndex = actionGroup
    ? sortedGroups.findIndex((group) => group.id === actionGroup.id)
    : -1;
  const actionOptionGroup = noteActionTarget?.kind === "NOTE_OPTION"
    ? groups.find((group) => group.id === noteActionTarget.groupId) ?? null
    : null;
  const actionOptions = actionOptionGroup
    ? [...actionOptionGroup.options].sort((left, right) => (
        left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-TW")
      ))
    : [];
  const actionOption = noteActionTarget?.kind === "NOTE_OPTION"
    ? actionOptions.find((option) => option.id === noteActionTarget.id) ?? null
    : null;
  const actionOptionIndex = actionOption
    ? actionOptions.findIndex((option) => option.id === actionOption.id)
    : -1;

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
          setMessageKind("error");
          setMessage(errorMessage);
        }
        return false;
      }
      setGroups(payload.noteGroups);
      setReusableNotes(payload.reusableNotes);
      onChange?.(payload.noteGroups, payload.reusableNotes);
      setMessageKind("success");
      setMessage(successMessage);
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? label(error.message) : m("目前無法更新註記群組。");
      if (inEditor) setEditorMessage(errorMessage);
      else {
        setMessageKind("error");
        setMessage(errorMessage);
      }
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
      setMessageKind("success");
      setMessage(m("商品註記已匯出。"));
    } catch (error) {
      setMessageKind("error");
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
      setMessageKind("error");
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
      setMessageKind("success");
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

  function closeReusableNoteNavigator() {
    setReusableNoteNavigatorOpen(false);
    setReusableNoteNavigatorQuery("");
  }

  function leaveReusableNoteNavigator(next: () => void) {
    closeReusableNoteNavigator();
    requestAnimationFrame(next);
  }

  function closeGroupNavigator() {
    setGroupNavigatorOpen(false);
    setGroupNavigatorGroupId(null);
    setGroupNavigatorQuery("");
  }

  function leaveGroupNavigator(next: () => void) {
    closeGroupNavigator();
    requestAnimationFrame(next);
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
          title={settingsExpanded ? label("摺疊商品註記設定") : label("展開商品註記設定")}
          data-testid="product-note-settings-toggle"
          aria-controls="product-note-settings-content"
          aria-expanded={settingsExpanded}
          onClick={() => setSettingsExpanded((current) => !current)}
          className="inline-grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300 text-sm font-semibold sm:inline-flex sm:w-auto sm:gap-2 sm:px-3"
        >
          <ChevronDown aria-hidden="true" className={`h-5 w-5 transition-transform ${settingsExpanded ? "rotate-180" : ""}`} />
          <span className="sr-only sm:not-sr-only">{settingsExpanded ? label("摺疊商品註記設定") : label("展開商品註記設定")}</span>
        </button>
      </div>

      {message ? <SettingsFeedbackDialog message={message} kind={messageKind} onClose={() => setMessage("")} /> : null}
      <div id="product-note-settings-content" hidden={!settingsExpanded}>
      <div data-testid="product-note-entry-actions" className="mt-5 grid gap-3 md:grid-cols-2">
        <button
          type="button"
          data-testid="open-reusable-note-navigator"
          onClick={() => {
            setReusableNoteNavigatorQuery("");
            setReusableNoteNavigatorOpen(true);
          }}
          className="flex min-h-28 w-full items-center gap-4 rounded-2xl border-2 border-teal-700 bg-teal-50 p-5 text-left shadow-sm transition hover:bg-teal-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-teal-700 text-white"><MessageSquareText className="h-7 w-7" /></span>
          <span className="min-w-0 flex-1">
            <strong className="block text-lg text-teal-950">{label("所有單一註記")}</strong>
            <span className="mt-1 block text-sm text-teal-900">{m("{count} 個單一註記", { count: reusableNotes.length })}</span>
          </span>
          <ChevronRight className="h-7 w-7 shrink-0 text-teal-800" />
        </button>
        <button
          type="button"
          data-testid="open-note-group-navigator"
          onClick={() => {
            setGroupNavigatorGroupId(null);
            setGroupNavigatorQuery("");
            setGroupNavigatorOpen(true);
          }}
          className="flex min-h-28 w-full items-center gap-4 rounded-2xl border-2 border-teal-700 bg-teal-50 p-5 text-left shadow-sm transition hover:bg-teal-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700"
        >
          <span className="grid h-14 w-14 shrink-0 place-items-center rounded-2xl bg-teal-700 text-white"><Layers3 className="h-7 w-7" /></span>
          <span className="min-w-0 flex-1">
            <strong className="block text-lg text-teal-950">{label("註記群組")}</strong>
            <span className="mt-1 block text-sm text-teal-900">{m("{groupCount} 個群組 · {optionCount} 個註記選項", { groupCount: groups.length, optionCount: groups.reduce((count, group) => count + group.options.length, 0) })}</span>
          </span>
          <ChevronRight className="h-7 w-7 shrink-0 text-teal-800" />
        </button>
      </div>

      {reusableNoteNavigatorOpen ? (
        <Editor
          title={label("所有單一註記")}
          onClose={closeReusableNoteNavigator}
          dialogRef={editorRef}
          errorMessage=""
          fullScreen
          testId="reusable-note-navigator-dialog"
        >
          <div className="grid gap-4">
            <ProductNoteTransferTools
              busy={busy}
              onExport={() => void exportProductNotes()}
              onImport={(file) => void previewProductNoteImport(file)}
            />
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
              <label className="relative block">
                <span className="sr-only">{label("搜尋單一註記")}</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400" />
                <input type="search" maxLength={80} value={reusableNoteNavigatorQuery} onChange={(event) => setReusableNoteNavigatorQuery(event.target.value)} placeholder={label("搜尋單一註記")} className="min-h-14 w-full rounded-xl border border-stone-300 pl-12 pr-4 text-base" />
              </label>
              <button type="button" onClick={() => leaveReusableNoteNavigator(() => setReusableNoteDraft({ name: "", priceDelta: 0, sortOrder: nextProductNoteSortOrder(reusableNotes), isActive: true, translations: [] }))} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 text-base font-semibold text-white"><Plus className="h-5 w-5" />{label("新增單一註記")}</button>
            </div>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleNavigatorReusableNotes.map((note) => (
                <ReusableProductNoteCard
                  key={note.id}
                  note={note}
                  currency={currency}
                  onOpen={() => leaveReusableNoteNavigator(() => setNoteActionTarget({ kind: "REUSABLE_NOTE", id: note.id }))}
                />
              ))}
              {visibleNavigatorReusableNotes.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 md:col-span-2 xl:col-span-3">{label(normalizedReusableNoteNavigatorQuery ? "找不到符合的單一註記。" : "尚未建立共用單一註記。")}</p> : null}
            </div>
          </div>
        </Editor>
      ) : null}

      {groupNavigatorOpen ? (
        <Editor
          title={groupNavigatorGroup ? groupNavigatorGroup.name : label("註記群組")}
          onClose={closeGroupNavigator}
          dialogRef={editorRef}
          errorMessage=""
          fullScreen
          testId="note-group-navigator-dialog"
        >
          <div className="grid gap-4">
            {!groupNavigatorGroup ? (
              <ProductNoteTransferTools
                busy={busy}
                onExport={() => void exportProductNotes()}
                onImport={(file) => void previewProductNoteImport(file)}
              />
            ) : null}
            <div className="grid gap-3 sm:grid-cols-[auto_minmax(0,1fr)_auto] sm:items-center">
              {groupNavigatorGroup ? (
                <button type="button" onClick={() => { setGroupNavigatorGroupId(null); setGroupNavigatorQuery(""); }} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl border border-stone-300 px-4 text-base font-semibold"><ChevronLeft className="h-5 w-5" />{label("返回註記群組")}</button>
              ) : <span />}
              <label className="relative block">
                <span className="sr-only">{label("搜尋註記群組或選項")}</span>
                <Search className="pointer-events-none absolute left-4 top-1/2 h-5 w-5 -translate-y-1/2 text-stone-400" />
                <input type="search" maxLength={80} value={groupNavigatorQuery} onChange={(event) => setGroupNavigatorQuery(event.target.value)} placeholder={label("搜尋註記群組或選項")} className="min-h-14 w-full rounded-xl border border-stone-300 pl-12 pr-4 text-base" />
              </label>
              {!groupNavigatorGroup ? (
                <button type="button" onClick={() => leaveGroupNavigator(() => setGroupDraft({ name: "", selectionMode: "MULTIPLE", isRequired: false, minSelections: 0, maxSelections: null, sortOrder: nextProductNoteSortOrder(groups), isActive: true, translations: [], productIds: [] }))} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 text-base font-semibold text-white"><Plus className="h-5 w-5" />{label("新增群組")}</button>
              ) : null}
            </div>

            {!groupNavigatorGroup ? (
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {visibleNavigatorGroups.map((group) => (
                  <ProductNoteGroupCard
                    key={group.id}
                    group={group}
                    onOpen={() => { setGroupNavigatorGroupId(group.id); setGroupNavigatorQuery(""); }}
                    onManage={() => leaveGroupNavigator(() => setNoteActionTarget({ kind: "NOTE_GROUP", id: group.id }))}
                  />
                ))}
                {visibleNavigatorGroups.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 md:col-span-2 xl:col-span-3">{label(normalizedGroupNavigatorQuery ? "找不到符合的註記群組。" : "尚未建立商品註記群組。")}</p> : null}
              </div>
            ) : (
              <div className="grid gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <button type="button" disabled={busy || sortedReusableNotes.every((note) => groupNavigatorGroup.options.some((option) => option.reusableNoteId === note.id))} onClick={() => leaveGroupNavigator(() => openAttachDialog(groupNavigatorGroup))} className="inline-flex min-h-14 items-center justify-center rounded-xl border border-teal-700 px-4 text-base font-semibold text-teal-800 disabled:opacity-40">{label("加入既有共用註記")}</button>
                  <button type="button" onClick={() => leaveGroupNavigator(() => setOptionDraft({ noteGroupId: groupNavigatorGroup.id, reusableNoteId: null, name: "", priceDelta: 0, sortOrder: nextProductNoteSortOrder(groupNavigatorGroup.options), isActive: true, translations: [] }))} className="inline-flex min-h-14 items-center justify-center gap-2 rounded-xl bg-stone-900 px-4 text-base font-semibold text-white"><Plus className="h-5 w-5" />{label("新增群組專用註記")}</button>
                </div>
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {visibleNavigatorOptions.map((option) => <ProductNoteOptionCard key={option.id} option={option} currency={currency} testId="note-option-action-trigger" onOpen={() => leaveGroupNavigator(() => setNoteActionTarget({ kind: "NOTE_OPTION", groupId: groupNavigatorGroup.id, id: option.id }))} />)}
                  {visibleNavigatorOptions.length === 0 ? <p className="rounded-xl border border-dashed border-stone-300 p-8 text-center text-sm text-stone-500 md:col-span-2 xl:col-span-3">{label(normalizedGroupNavigatorQuery ? "找不到符合的註記選項。" : "尚未建立註記選項。")}</p> : null}
                </div>
              </div>
            )}
          </div>
        </Editor>
      ) : null}

      {actionReusableNote ? (
        <Editor title={m("管理 {name}", { name: actionReusableNote.name })} onClose={() => setNoteActionTarget(null)} dialogRef={editorRef} errorMessage="">
          <div data-testid="product-note-action-dialog" className="grid grid-cols-2 gap-3">
            <ProductNoteActionButton disabled={busy || actionReusableNoteIndex === 0} icon={<ArrowUp className="h-6 w-6" />} label={label("上移")} onSelect={() => { setNoteActionTarget(null); void moveReusableNote(actionReusableNoteIndex, -1); }} />
            <ProductNoteActionButton disabled={busy || actionReusableNoteIndex === sortedReusableNotes.length - 1} icon={<ArrowDown className="h-6 w-6" />} label={label("下移")} onSelect={() => { setNoteActionTarget(null); void moveReusableNote(actionReusableNoteIndex, 1); }} />
            <ProductNoteActionButton disabled={busy} icon={<Pencil className="h-6 w-6" />} label={label("編輯")} onSelect={() => { setNoteActionTarget(null); setReusableNoteDraft({ id: actionReusableNote.id, name: actionReusableNote.name, priceDelta: actionReusableNote.priceDelta, sortOrder: actionReusableNote.sortOrder, isActive: actionReusableNote.isActive, translations: actionReusableNote.translations }); }} />
            <ProductNoteActionButton disabled={busy} icon={actionReusableNote.isActive ? <EyeOff className="h-6 w-6" /> : <Eye className="h-6 w-6" />} label={actionReusableNote.isActive ? label("停用") : label("啟用")} onSelect={() => { setNoteActionTarget(null); void toggleReusableNote(actionReusableNote); }} />
            <ProductNoteActionButton disabled={busy} danger icon={<Trash2 className="h-6 w-6" />} label={label("刪除")} onSelect={() => { setNoteActionTarget(null); void deleteReusableNote(actionReusableNote); }} />
          </div>
        </Editor>
      ) : null}

      {actionGroup ? (
        <Editor title={m("管理 {name}", { name: actionGroup.name })} onClose={() => setNoteActionTarget(null)} dialogRef={editorRef} errorMessage="">
          <div data-testid="product-note-action-dialog" className="grid grid-cols-2 gap-3">
            <ProductNoteActionButton disabled={busy || actionGroupIndex === 0} icon={<ArrowUp className="h-6 w-6" />} label={label("上移")} onSelect={() => { setNoteActionTarget(null); void moveNoteGroup(actionGroupIndex, -1); }} />
            <ProductNoteActionButton disabled={busy || actionGroupIndex === sortedGroups.length - 1} icon={<ArrowDown className="h-6 w-6" />} label={label("下移")} onSelect={() => { setNoteActionTarget(null); void moveNoteGroup(actionGroupIndex, 1); }} />
            <ProductNoteActionButton disabled={busy} icon={<Pencil className="h-6 w-6" />} label={label("編輯")} onSelect={() => { setNoteActionTarget(null); editGroup(actionGroup); }} />
            <ProductNoteActionButton disabled={busy} icon={actionGroup.isActive ? <EyeOff className="h-6 w-6" /> : <Eye className="h-6 w-6" />} label={actionGroup.isActive ? label("停用") : label("啟用")} onSelect={() => { setNoteActionTarget(null); void toggleGroup(actionGroup); }} />
            <ProductNoteActionButton disabled={busy} danger icon={<Trash2 className="h-6 w-6" />} label={label("刪除")} onSelect={() => { setNoteActionTarget(null); void deleteGroup(actionGroup); }} />
          </div>
        </Editor>
      ) : null}

      {actionOption && actionOptionGroup ? (
        <Editor title={m("管理 {name}", { name: actionOption.name })} onClose={() => setNoteActionTarget(null)} dialogRef={editorRef} errorMessage="">
          <div data-testid="product-note-action-dialog" className="grid grid-cols-2 gap-3">
            <ProductNoteActionButton disabled={busy || actionOptionIndex === 0} icon={<ArrowUp className="h-6 w-6" />} label={label("上移")} onSelect={() => { setNoteActionTarget(null); void moveNoteOption(actionOptionGroup.id, actionOptions, actionOptionIndex, -1); }} />
            <ProductNoteActionButton disabled={busy || actionOptionIndex === actionOptions.length - 1} icon={<ArrowDown className="h-6 w-6" />} label={label("下移")} onSelect={() => { setNoteActionTarget(null); void moveNoteOption(actionOptionGroup.id, actionOptions, actionOptionIndex, 1); }} />
            <ProductNoteActionButton disabled={busy} icon={<Pencil className="h-6 w-6" />} label={actionOption.reusableNoteId ? label("調整排序") : label("編輯")} onSelect={() => { setNoteActionTarget(null); setOptionDraft({ ...actionOption, noteGroupId: actionOptionGroup.id }); }} />
            {!actionOption.reusableNoteId ? <ProductNoteActionButton disabled={busy} icon={actionOption.isActive ? <EyeOff className="h-6 w-6" /> : <Eye className="h-6 w-6" />} label={actionOption.isActive ? label("停用") : label("啟用")} onSelect={() => { setNoteActionTarget(null); void toggleOption(actionOption); }} /> : null}
            <ProductNoteActionButton disabled={busy} danger icon={<Trash2 className="h-6 w-6" />} label={actionOption.reusableNoteId ? label("從群組移除") : label("刪除")} onSelect={() => { setNoteActionTarget(null); void deleteOption(actionOption); }} />
          </div>
        </Editor>
      ) : null}

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
            <p className="shrink-0 text-sm text-stone-600">{label("搜尋後點選大型開關，加入此群組的共用註記；已加入的註記不會重複顯示。")}</p>
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
                return <TouchSwitch
                  key={note.id}
                  accessibleLabel={note.name}
                  label={<span className="flex min-w-0 flex-1 flex-wrap items-center gap-2"><span className="min-w-0 flex-1 break-words">{note.name}</span><span className="shrink-0 text-xs text-stone-500">{note.priceDelta === 0 ? label("不加價") : `${note.priceDelta > 0 ? "+" : ""}${formatMoney(note.priceDelta, currency, locale)}`}</span>{!note.isActive ? <span className="shrink-0 text-xs text-red-700">{label("已停用")}</span> : null}</span>}
                  checked={selected}
                  disabled={busy || (attachDialog.reusableNoteIds.length >= MAX_REUSABLE_NOTES_PER_BATCH && !selected)}
                  onChange={(checked) => updateAttachSelection(note.id, checked)}
                />;
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
            <fieldset tabIndex={-1} data-field-key="productIds" aria-invalid={Boolean(editorFieldErrors.productIds)} aria-describedby={editorFieldErrors.productIds ? "product-note-productIds-error" : undefined} className={`sm:col-span-2 rounded-md ${editorFieldErrors.productIds ? "border border-red-500 bg-red-50 p-2" : ""}`}>
              <legend className="text-sm font-semibold text-stone-700">{label("指派商品")}</legend>
              <div className="mt-2 max-h-72 overflow-y-auto border-y border-stone-200 py-2">
                {productsByCategory.map(([categoryName, categoryProducts]) => (
                  <details key={categoryName} open>
                    <summary className="cursor-pointer py-2 text-sm font-semibold">{categoryName}</summary>
                    <div className="grid gap-2 pb-3 sm:grid-cols-2">
                      {categoryProducts.map((product) => {
                        const selected = groupDraft.productIds.includes(product.id);
                        return <TouchSwitch
                          key={product.id}
                          accessibleLabel={product.name}
                          label={<span>{product.name}{!product.isActive ? <span className="ml-2 text-xs text-stone-500">{label("（已停用）")}</span> : null}</span>}
                          checked={selected}
                          onChange={(checked) => {
                            clearEditorField("productIds");
                            setGroupDraft({ ...groupDraft, productIds: checked ? [...groupDraft.productIds, product.id] : groupDraft.productIds.filter((id) => id !== product.id) });
                          }}
                        />;
                      })}
                    </div>
                  </details>
                ))}
              </div>
              {editorFieldErrors.productIds ? <span id="product-note-productIds-error" role="alert" className="mt-1 block text-xs text-red-700">{editorFieldErrors.productIds}</span> : null}
            </fieldset>
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

function ProductNoteTransferTools({
  busy,
  onExport,
  onImport,
}: {
  busy: boolean;
  onExport: () => void;
  onImport: (file: File) => void;
}) {
  const { label } = useMerchantMessages();
  return (
    <div className="flex flex-wrap justify-end gap-2 border-b border-stone-200 pb-4">
      <button
        type="button"
        disabled={busy}
        onClick={onExport}
        className="inline-flex min-h-11 items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-semibold disabled:opacity-50"
      >
        <Download className="h-5 w-5" />{label("匯出 JSON")}
      </button>
      <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-stone-300 px-3 text-sm font-semibold focus-within:outline-none focus-within:ring-2 focus-within:ring-teal-700 focus-within:ring-offset-2">
        <Upload className="h-5 w-5" />{label("匯入 JSON")}
        <input
          type="file"
          aria-label={label("匯入 JSON")}
          accept=".json,application/json"
          className="sr-only"
          disabled={busy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) onImport(file);
            event.currentTarget.value = "";
          }}
        />
      </label>
    </div>
  );
}

function TranslationFields({ translations, options, onChange }: { translations: Translation[]; options: ReturnType<typeof getTranslationLocaleOptions>; onChange: (items: Translation[]) => void }) {
  const { label } = useMerchantMessages();
  if (options.length === 0) return null;
  return <details className="border-t border-stone-200 pt-3 sm:col-span-2"><summary className="cursor-pointer text-sm font-semibold">{label("註記翻譯")}</summary><div className="mt-3 grid gap-3 sm:grid-cols-2">{options.map((option) => { const current = translations.find((item) => item.locale === option.locale)?.name ?? ""; return <label key={option.locale} className="text-sm font-medium text-stone-700">{label(option.label)}<input type="text" maxLength={120} value={current} onChange={(event) => { const next = translations.filter((item) => item.locale !== option.locale); if (event.target.value) next.push({ locale: option.locale, name: event.target.value }); onChange(next); }} className="mt-1 w-full rounded-md border border-stone-300 px-3 py-2" /></label>; })}</div></details>;
}

function Editor({ title, onClose, dialogRef, errorMessage, wide = false, constrained = false, fullScreen = false, testId, closeDisabled = false, children }: { title: string; onClose: () => void; dialogRef: React.RefObject<HTMLElement | null>; errorMessage: string; wide?: boolean; constrained?: boolean; fullScreen?: boolean; testId?: string; closeDisabled?: boolean; children: React.ReactNode }) {
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
    <div className={`fixed inset-0 z-50 grid place-items-center overscroll-contain bg-black/45 ${constrained || fullScreen ? "overflow-hidden p-2 sm:p-4" : "overflow-y-auto p-4"}`}>
      <section
        ref={dialogRef}
        data-testid={testId}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`my-auto w-full rounded-lg bg-white p-5 shadow-xl ${fullScreen ? "flex h-[calc(100dvh-1rem)] max-h-[calc(100dvh-1rem)] max-w-6xl flex-col overflow-hidden sm:h-[min(92dvh,900px)] sm:max-h-[min(92dvh,900px)]" : `${wide ? "max-w-2xl" : "max-w-md"} ${constrained ? "flex h-[calc(100dvh-1rem)] max-h-[52rem] flex-col overflow-hidden sm:h-[calc(100dvh-2rem)]" : ""}`}`}
      >
        <div className="mb-4 flex shrink-0 items-center justify-between gap-3"><h2 className="min-w-0 break-words text-lg font-semibold">{title}</h2><IconButton label={label("關閉")} disabled={closeDisabled} onClick={onClose}><X className="h-4 w-4" /></IconButton></div>
        {errorMessage ? <p role="alert" className="mb-4 shrink-0 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">{errorMessage}</p> : null}
        {fullScreen ? <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">{children}</div> : constrained ? <div className="flex min-h-0 flex-1 flex-col">{children}</div> : children}
      </section>
    </div>
  );
}

function IconButton({ label, danger = false, disabled = false, testId, onClick, children }: { label: string; danger?: boolean; disabled?: boolean; testId?: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode }) {
  return <button type="button" data-testid={testId} title={label} aria-label={label} disabled={disabled} onClick={onClick} className={`grid h-11 w-11 shrink-0 place-items-center rounded-md border bg-white hover:bg-stone-100 disabled:cursor-not-allowed disabled:opacity-50 ${danger ? "border-red-200 text-red-700" : "border-stone-200 text-stone-600"}`}>{children}</button>;
}

function ProductNoteActionButton({ icon, label, onSelect, disabled = false, danger = false }: { icon: React.ReactNode; label: string; onSelect: () => void; disabled?: boolean; danger?: boolean }) {
  return <button type="button" disabled={disabled} onClick={onSelect} className={`flex min-h-24 min-w-0 flex-col items-center justify-center gap-2 rounded-lg border p-3 text-center text-base font-semibold disabled:opacity-35 ${danger ? "border-red-200 text-red-700" : "border-stone-300 text-stone-900"}`}>{icon}<span className="break-words leading-tight">{label}</span></button>;
}

function ProductNoteGroupCard({ group, onOpen, onManage }: { group: ProductNoteGroupView; onOpen: () => void; onManage: () => void }) {
  const { m, label } = useMerchantMessages();
  return (
    <div className="grid min-h-28 grid-cols-[minmax(0,1fr)_auto] overflow-hidden rounded-2xl border border-stone-300 bg-white shadow-sm">
      <button type="button" onClick={onOpen} className="flex min-w-0 items-center gap-4 p-5 text-left hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-teal-700">
        <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800"><MessageSquareText className="h-6 w-6" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2"><strong className="break-words text-lg">{group.name}</strong>{!group.isActive ? <span className="text-xs font-semibold text-red-700">{label("已停用")}</span> : null}</span>
          <span className="mt-1 block text-sm text-stone-600">{m("{selectionMode} · {required} · {optionCount} 個註記選項 · {productCount} 項商品", { selectionMode: group.selectionMode === "SINGLE" ? label("單選") : label("複選"), required: group.isRequired ? label("必選") : label("選填"), optionCount: group.options.length, productCount: group.assignments.length })}</span>
        </span>
        <ChevronRight className="h-6 w-6 shrink-0 text-stone-500" />
      </button>
      <div className="grid place-items-center border-l border-stone-200 px-3"><IconButton testId="note-group-action-trigger" label={m("管理 {name}", { name: group.name })} onClick={onManage}><MoreHorizontal className="h-5 w-5" /></IconButton></div>
    </div>
  );
}

function ReusableProductNoteCard({ note, currency, onOpen }: { note: ReusableProductNoteView; currency: string; onOpen: () => void }) {
  const { locale, m, label } = useMerchantMessages();
  return (
    <button type="button" data-testid="reusable-note-action-trigger" aria-label={m("管理 {name}", { name: note.name })} onClick={onOpen} className="flex min-h-28 w-full items-center gap-4 rounded-2xl border border-stone-300 bg-white p-5 text-left shadow-sm hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-700"><MessageSquareText className="h-6 w-6" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><strong className="break-words text-lg">{note.name}</strong>{!note.isActive ? <span className="text-xs font-semibold text-red-700">{label("已停用")}</span> : null}</span>
        <span className="mt-1 block text-sm text-stone-600">{m("{price} · 排序 {sortOrder} · 已加入 {count} 個群組", { price: note.priceDelta === 0 ? label("不加價") : `${note.priceDelta > 0 ? "+" : ""}${formatMoney(note.priceDelta, currency, locale)}`, sortOrder: note.sortOrder, count: note.linkedOptionCount })}</span>
      </span>
      <MoreHorizontal className="h-6 w-6 shrink-0 text-stone-500" />
    </button>
  );
}

function ProductNoteOptionCard({ option, currency, testId, onOpen }: { option: NoteOption; currency: string; testId?: string; onOpen: () => void }) {
  const { locale, label } = useMerchantMessages();
  return (
    <button type="button" data-testid={testId} onClick={onOpen} className="flex min-h-28 w-full items-center gap-4 rounded-2xl border border-stone-300 bg-white p-5 text-left shadow-sm hover:bg-stone-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700">
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-stone-100 text-stone-700"><MessageSquareText className="h-6 w-6" /></span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2"><strong className="break-words text-lg">{option.name}</strong>{!option.isActive ? <span className="text-xs font-semibold text-red-700">{label("已停用")}</span> : null}</span>
        <span className="mt-1 block text-sm text-stone-600">{option.priceDelta === 0 ? label("不加價") : `${option.priceDelta > 0 ? "+" : ""}${formatMoney(option.priceDelta, currency, locale)}`} · {option.reusableNoteId ? label("共用單一註記") : label("群組專用")}</span>
      </span>
      <MoreHorizontal className="h-6 w-6 shrink-0 text-stone-500" />
    </button>
  );
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
  return <TouchSwitch label={label} checked={checked} onChange={onChange} />;
}
function TouchSwitch({ label, accessibleLabel, checked, disabled = false, onChange }: { label: ReactNode; accessibleLabel?: string; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-label={accessibleLabel} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`flex min-h-14 w-full items-center justify-between gap-4 rounded-xl border px-4 py-3 text-left text-sm font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-teal-700 disabled:cursor-not-allowed disabled:opacity-40 ${checked ? "border-teal-700 bg-teal-50 text-teal-950" : "border-stone-300 bg-white text-stone-700"}`}><span className="min-w-0 flex-1">{label}</span><span aria-hidden="true" className={`relative h-8 w-14 shrink-0 rounded-full transition ${checked ? "bg-teal-700" : "bg-stone-300"}`}><span className={`absolute top-1 grid h-6 w-6 place-items-center rounded-full bg-white shadow transition-transform ${checked ? "translate-x-7 text-teal-700" : "translate-x-1 text-stone-400"}`}>{checked ? <Check className="h-4 w-4" /> : null}</span></span></button>;
}
function SubmitButton({ busy }: { busy: boolean }) {
  const { label } = useMerchantMessages();
  return <button disabled={busy} type="submit" className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50 sm:col-span-2"><Check className="h-4 w-4" />{label("儲存")}</button>;
}
