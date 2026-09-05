"use client";

import { useState } from "react";
import { Bluetooth, Cable, Check, Cloud, Copy, KeyRound, Pencil, Plus, Power, Printer, ReceiptText, RotateCw, Save, TestTube2, Trash2, TriangleAlert } from "lucide-react";
import { useOperationsLocale } from "@/components/operations-locale";
import {
  MAX_PRINT_RULES_PER_STALL,
  printRuleDraftFromView,
} from "@/lib/print-center-types";
import type {
  PrinterConnectionType,
  PrinterView,
  CloudPrntSetup,
  PrintFulfillmentType,
  PrintOrderOrigin,
  PrintOrderSource,
  PrintQueueState,
  PrintRuleDraft,
  PrintRuleView,
  RunPrintQueueCommand,
} from "@/lib/print-center-types";

type PrinterDraft = {
  name: string;
  connectionType: PrinterConnectionType;
  model: string;
  paperWidthMm: 58 | 80;
  autoDetectEnabled: boolean;
  openCashDrawerOnCashPayment: boolean;
};

const emptyPrinter: PrinterDraft = {
  name: "",
  connectionType: "WEBPRNT_BLUETOOTH",
  model: "MCP31LB",
  paperWidthMm: 58,
  autoDetectEnabled: true,
  openCashDrawerOnCashPayment: false,
};

const sourceOptions: PrintOrderSource[] = ["QR_MENU", "STAFF_POS", "LINE_DELIVERY"];
const originOptions: PrintOrderOrigin[] = ["ONLINE_QR", "ONLINE_STAFF", "OFFLINE_POS", "IMPORTED"];
const fulfillmentOptions: PrintFulfillmentType[] = ["TAKEOUT", "DINE_IN", "DELIVERY"];

export function PrintCenterSettings({
  state,
  busy,
  activePrinterId,
  onRun,
  onTakeOver,
  onTest,
  onOpenCashDrawer,
}: {
  state: PrintQueueState;
  busy: boolean;
  activePrinterId: string | null;
  onRun: RunPrintQueueCommand;
  onTakeOver: (printer: PrinterView) => void;
  onTest: (printer: PrinterView) => Promise<void>;
  onOpenCashDrawer: (printer: PrinterView) => Promise<void>;
}) {
  const { t } = useOperationsLocale();
  const [printerDraft, setPrinterDraft] = useState<PrinterDraft>(emptyPrinter);
  const [editingPrinterId, setEditingPrinterId] = useState<string | null>(null);
  const [editingPrinter, setEditingPrinter] = useState<(PrinterDraft & { isEnabled: boolean }) | null>(null);
  const [cloudPrntSetup, setCloudPrntSetup] = useState<CloudPrntSetup>();
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [ruleEditor, setRuleEditor] = useState<{ id: string | null; draft: PrintRuleDraft } | null>(null);
  const ruleLimitReached = state.rules.length >= MAX_PRINT_RULES_PER_STALL;

  async function registerPrinter() {
    if (!printerDraft.name.trim()) return;
    const result = await onRun(
      { operation: "REGISTER_PRINTER", ...printerDraft },
      t("print.printerAdded"),
    );
    if (result) {
      setPrinterDraft(emptyPrinter);
      if (result.cloudPrntSetup) setCloudPrntSetup(result.cloudPrntSetup);
    }
  }

  function beginPrinterEdit(printer: PrinterView) {
    setEditingPrinterId(printer.id);
    setEditingPrinter({
      name: printer.name,
      connectionType: printer.connectionType,
      model: printer.model,
      paperWidthMm: printer.paperWidthMm === 80 ? 80 : 58,
      autoDetectEnabled: printer.autoDetectEnabled,
      openCashDrawerOnCashPayment: printer.openCashDrawerOnCashPayment,
      isEnabled: printer.isEnabled,
    });
  }

  async function savePrinter() {
    if (!editingPrinterId || !editingPrinter?.name.trim()) return;
    const result = await onRun(
      { operation: "UPDATE_PRINTER", printerId: editingPrinterId, ...editingPrinter },
      t("print.device.saved"),
    );
    if (result) {
      if (result.cloudPrntSetup) setCloudPrntSetup(result.cloudPrntSetup);
      setEditingPrinterId(null);
      setEditingPrinter(null);
    }
  }

  async function togglePrinter(printer: PrinterView) {
    await onRun({
      operation: "UPDATE_PRINTER",
      printerId: printer.id,
      name: printer.name,
      connectionType: printer.connectionType,
      model: printer.model,
      paperWidthMm: printer.paperWidthMm === 80 ? 80 : 58,
      autoDetectEnabled: printer.autoDetectEnabled,
      openCashDrawerOnCashPayment: printer.openCashDrawerOnCashPayment,
      isEnabled: !printer.isEnabled,
    }, printer.isEnabled ? t("print.device.disabled") : t("print.device.enabled"));
  }

  async function generateCloudPrntPassword(printer: PrinterView) {
    const confirmation = printer.hasCloudPrntCredentials
      ? t("print.cloud.rotateConfirm", { name: printer.name })
      : t("print.cloud.generateConfirm", { name: printer.name });
    if (!window.confirm(confirmation)) return;
    const result = await onRun(
      { operation: "ROTATE_CLOUDPRNT_TOKEN", printerId: printer.id },
      t("print.cloud.generated"),
    );
    if (result?.cloudPrntSetup) setCloudPrntSetup(result.cloudPrntSetup);
  }

  async function copyCloudPrntField(field: string, value: string) {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(field);
      window.setTimeout(() => setCopiedField((current) => current === field ? null : current), 2_000);
    } catch {
      setCopiedField(null);
    }
  }

  function beginNewRule() {
    setRuleEditor({
      id: null,
      draft: {
        name: t("print.rule.defaultName"),
        printerId: state.printers.find((printer) => printer.isEnabled)?.id ?? "",
        isEnabled: true,
        documentType: "KITCHEN_TICKET",
        trigger: "ORDER_CONFIRMED",
        orderSources: [...sourceOptions],
        orderOrigins: [],
        fulfillmentTypes: [],
        productCategoryIds: [],
        productGroupIds: [],
        copies: 1,
        fontScale: 1,
        splitMode: "NONE",
        aggregateItems: false,
        autoPrint: true,
        showCustomerName: true,
        showCustomerPhone: true,
        showDeliveryAddress: true,
        showOrderNote: true,
        showItemNotes: true,
        showPrices: true,
        showPaymentMethod: true,
        feedLines: 2,
        sortOrder: state.rules.length * 10,
      },
    });
  }

  function beginRuleEdit(rule: PrintRuleView) {
    const draft = printRuleDraftFromView(rule);
    const cloudPrinter = state.printers.some((printer) => (
      printer.id === draft.printerId && printer.connectionType === "CLOUDPRNT"
    ));
    setRuleEditor({ id: rule.id, draft: cloudPrinter ? { ...draft, autoPrint: true } : draft });
  }

  async function saveRule() {
    if (!ruleEditor?.draft.name.trim() || !ruleEditor.draft.printerId) return;
    const command = ruleEditor.id
      ? { operation: "UPDATE_RULE", ruleId: ruleEditor.id, rule: ruleEditor.draft }
      : { operation: "CREATE_RULE", rule: ruleEditor.draft };
    const result = await onRun(command, ruleEditor.id ? t("print.rule.saved") : t("print.rule.created"));
    if (result) setRuleEditor(null);
  }

  async function deleteRule(rule: PrintRuleView) {
    if (!window.confirm(t("print.rule.deleteConfirm", { name: rule.name }))) return;
    await onRun({ operation: "DELETE_RULE", ruleId: rule.id }, t("print.rule.deleted"));
    if (ruleEditor?.id === rule.id) setRuleEditor(null);
  }

  return <>
    <section className="mt-6 border-y border-stone-200 py-5 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Printer className="h-5 w-5 text-teal-700" />{t("print.device.title")}</h2>
          <p className="mt-1 text-xs text-stone-500">{t("print.device.hint")}</p>
        </div>
      </div>

      <div data-print-hardware-diagnostics className="mt-4 grid gap-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-950 sm:grid-cols-2">
        <p className="flex items-start gap-2"><Cable aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t("print.device.iosSafariTransport")}</p>
        <p className="flex items-start gap-2"><TriangleAlert aria-hidden="true" className="mt-0.5 h-4 w-4 shrink-0" />{t("print.device.drawerCableWarning")}</p>
      </div>

      <details className="mt-4 rounded-md border border-stone-200 p-3" open={state.printers.length === 0}>
        <summary className="cursor-pointer text-sm font-semibold">{t("print.device.add")}</summary>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <TextField label={t("print.printerName")} value={printerDraft.name} onChange={(name) => setPrinterDraft((current) => ({ ...current, name }))} />
          <ConnectionSelect value={printerDraft.connectionType} onChange={(connectionType) => setPrinterDraft((current) => ({ ...current, connectionType, ...(connectionType === "CLOUDPRNT" ? { autoDetectEnabled: false } : {}) }))} />
          <TextField label={t("print.device.model")} value={printerDraft.model} onChange={(model) => setPrinterDraft((current) => ({ ...current, model }))} />
          <PaperSelect value={printerDraft.paperWidthMm} onChange={(paperWidthMm) => setPrinterDraft((current) => ({ ...current, paperWidthMm }))} />
          <div className="flex flex-wrap gap-4 sm:col-span-2 lg:col-span-4">
            <ToggleCheckbox label={t("print.device.autoDetect")} checked={printerDraft.autoDetectEnabled} onChange={() => setPrinterDraft((current) => ({ ...current, autoDetectEnabled: !current.autoDetectEnabled }))} />
            <ToggleCheckbox label={t("print.device.cashDrawerAutomatic")} checked={printerDraft.openCashDrawerOnCashPayment} onChange={() => setPrinterDraft((current) => ({ ...current, openCashDrawerOnCashPayment: !current.openCashDrawerOnCashPayment }))} />
          </div>
        </div>
        <button type="button" disabled={busy || !printerDraft.name.trim()} onClick={() => void registerPrinter()} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4" />{t("common.add")}</button>
      </details>

      {cloudPrntSetup ? <section data-cloudprnt-one-time-setup role="alert" className="mt-4 rounded-md border-2 border-amber-400 bg-amber-50 p-4 text-sm text-amber-950">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0"><h3 className="flex items-center gap-2 font-semibold"><KeyRound className="h-4 w-4 shrink-0" />{t("print.cloud.setupTitle")}</h3><p className="mt-1 text-xs leading-5">{t("print.cloud.setupOnce")}</p></div>
          <button type="button" onClick={() => { setCloudPrntSetup(undefined); setCopiedField(null); }} className="min-h-11 shrink-0 rounded-md border border-amber-400 px-3 text-xs font-semibold">{t("common.close")}</button>
        </div>
        <div className="mt-3 grid min-w-0 gap-2">
          <CloudSetupValue label={t("print.cloud.serverUrl")} value={cloudPrntSetup.serverUrl} field="setup-server-url" copiedField={copiedField} onCopy={copyCloudPrntField} />
          <CloudSetupValue label={t("print.cloud.username")} value={cloudPrntSetup.deviceId} field="setup-device-id" copiedField={copiedField} onCopy={copyCloudPrntField} />
          <CloudSetupValue label={t("print.cloud.password")} value={cloudPrntSetup.deviceToken} field="setup-device-token" copiedField={copiedField} onCopy={copyCloudPrntField} />
        </div>
        <p className="mt-3 text-xs">{t("print.cloud.setupTiming", { poll: cloudPrntSetup.pollingIntervalSeconds, timeout: cloudPrntSetup.responseTimeoutSeconds })}</p>
        <p className="mt-1 text-xs font-semibold">{t("print.cloud.setupAuth")}</p>
      </section> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-2">{state.printers.map((printer) => {
        const editing = editingPrinterId === printer.id && editingPrinter;
        return <article key={printer.id} className={`rounded-md border p-3 ${printer.isEnabled ? "border-stone-200" : "border-stone-200 bg-stone-50 opacity-75"}`}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2"><ConnectionIcon type={printer.connectionType} /><strong className="truncate text-sm">{printer.name}</strong></div>
              <p className="mt-1 text-xs text-stone-500">{connectionLabel(t, printer.connectionType)} · {printer.model} · {printer.paperWidthMm === 80 ? "80 mm" : "57–58 mm"}</p>
              <p className={`mt-1 text-xs font-semibold ${printer.isOnline ? "text-emerald-700" : "text-stone-500"}`}>{printer.isOnline ? t("print.online") : t("print.offline")}{activePrinterId === printer.id ? ` · ${t("print.localActive")}` : ""}</p>
              {printer.connectionType === "CLOUDPRNT" ? <div data-cloudprnt-server-url className="mt-3 min-w-0 space-y-2 rounded-md border border-teal-200 bg-teal-50/60 p-2">
                <CloudSetupValue label={t("print.cloud.serverUrl")} value={printer.cloudPrntServerUrl ?? t("print.cloud.urlUnavailable")} field={`server-url-${printer.id}`} copiedField={copiedField} onCopy={copyCloudPrntField} copyable={Boolean(printer.cloudPrntServerUrl)} />
                <CloudSetupValue label={t("print.cloud.username")} value={printer.deviceId ?? t("print.cloud.notConfigured")} field={`device-id-${printer.id}`} copiedField={copiedField} onCopy={copyCloudPrntField} copyable={Boolean(printer.deviceId)} />
                <p className="text-[11px] leading-4 text-stone-600">{t("print.cloud.passwordHidden")}</p>
              </div> : <p className="mt-1 text-xs text-stone-500">{printer.autoDetectEnabled ? t("print.device.autoDetectOn") : t("print.device.autoDetectOff")}{printer.openCashDrawerOnCashPayment ? ` · ${t("print.device.cashDrawerOn")}` : ""}</p>}
            </div>
            <button type="button" title={t("common.edit")} onClick={() => beginPrinterEdit(printer)} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-stone-300"><Pencil className="h-4 w-4" /></button>
          </div>
          {editing ? <div className="mt-3 grid gap-3 border-t border-stone-200 pt-3 sm:grid-cols-2">
            <TextField label={t("print.printerName")} value={editing.name} onChange={(name) => setEditingPrinter((current) => current ? { ...current, name } : current)} />
            <ConnectionSelect value={editing.connectionType} onChange={(connectionType) => setEditingPrinter((current) => current ? { ...current, connectionType } : current)} />
            <TextField label={t("print.device.model")} value={editing.model} onChange={(model) => setEditingPrinter((current) => current ? { ...current, model } : current)} />
            <PaperSelect value={editing.paperWidthMm} onChange={(paperWidthMm) => setEditingPrinter((current) => current ? { ...current, paperWidthMm } : current)} />
            <div className="flex flex-wrap gap-4 sm:col-span-2">
              <ToggleCheckbox label={t("print.device.autoDetect")} checked={editing.autoDetectEnabled} onChange={() => setEditingPrinter((current) => current ? { ...current, autoDetectEnabled: !current.autoDetectEnabled } : current)} />
              <ToggleCheckbox label={t("print.device.cashDrawerAutomatic")} checked={editing.openCashDrawerOnCashPayment} onChange={() => setEditingPrinter((current) => current ? { ...current, openCashDrawerOnCashPayment: !current.openCashDrawerOnCashPayment } : current)} />
            </div>
            <div className="flex gap-2 sm:col-span-2"><button type="button" disabled={busy || !editing.name.trim()} onClick={() => void savePrinter()} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-stone-900 px-3 text-xs font-semibold text-white"><Save className="h-4 w-4" />{t("common.save")}</button><button type="button" onClick={() => { setEditingPrinterId(null); setEditingPrinter(null); }} className="min-h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold">{t("common.cancel")}</button></div>
          </div> : null}
          <div className="mt-3 flex flex-wrap gap-2 border-t border-stone-100 pt-3">
            {printer.connectionType !== "CLOUDPRNT" ? <button type="button" disabled={busy || !printer.isEnabled || activePrinterId === printer.id} onClick={() => onTakeOver(printer)} className="min-h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40">{t("print.takeOver")}</button> : <span className="self-center text-xs text-stone-500">{t("print.device.cloudAutonomous")}</span>}
            <button type="button" disabled={busy || !printer.isEnabled} onClick={() => void onTest(printer)} className="inline-flex min-h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40"><TestTube2 className="h-4 w-4" />{t("print.device.test")}</button>
            {printer.connectionType === "CLOUDPRNT" ? <button type="button" disabled={busy || !printer.isEnabled} onClick={() => void generateCloudPrntPassword(printer)} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40"><RotateCw className="h-4 w-4" />{t("print.cloud.generatePassword")}</button> : null}
            {printer.connectionType === "WEBPRNT_BLUETOOTH" ? <button type="button" disabled={busy || !printer.isEnabled || activePrinterId !== printer.id} onClick={() => void onOpenCashDrawer(printer)} className="min-h-9 rounded-md border border-stone-300 px-3 text-xs font-semibold disabled:opacity-40">{t("print.drawer.open")}</button> : null}
            <button type="button" disabled={busy} onClick={() => void togglePrinter(printer)} className="ml-auto inline-flex min-h-9 items-center gap-2 rounded-md border border-stone-300 px-3 text-xs font-semibold"><Power className="h-4 w-4" />{printer.isEnabled ? t("print.device.disable") : t("print.device.enable")}</button>
          </div>
        </article>;
      })}</div>
      {state.printers.length === 0 ? <p className="mt-4 text-sm text-red-700">{t("print.noPrinter")}</p> : null}
    </section>

    <section className="border-b border-stone-200 py-5 print:hidden">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="flex items-center gap-2 text-lg font-semibold"><ReceiptText className="h-5 w-5 text-teal-700" />{t("print.rule.title")}</h2><p className="mt-1 text-xs text-stone-500">{t("print.rule.hint")}</p></div>
        <button type="button" disabled={busy || state.printers.length === 0 || ruleLimitReached} onClick={beginNewRule} className="inline-flex min-h-9 items-center gap-2 rounded-md bg-teal-800 px-3 text-xs font-semibold text-white disabled:opacity-40"><Plus className="h-4 w-4" />{t("print.rule.add")}</button>
      </div>
      {ruleLimitReached ? <p className="mt-2 text-xs font-medium text-amber-700">{t("print.rule.limitReached", { count: MAX_PRINT_RULES_PER_STALL })}</p> : null}

      <div className="mt-4 divide-y divide-stone-200 border-y border-stone-200">{state.rules.map((rule) => <article key={rule.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><strong>{rule.name}</strong><span className={`rounded px-2 py-0.5 text-xs font-semibold ${rule.isEnabled ? "bg-emerald-50 text-emerald-700" : "bg-stone-100 text-stone-500"}`}>{rule.isEnabled ? t("common.enabled") : t("common.disabled")}</span></div><p className="mt-1 text-xs text-stone-500">{rule.printer.name} · {documentLabel(t, rule.documentType)} · {triggerLabel(t, rule.trigger)} · {t("print.rule.copiesSummary", { count: rule.copies })}</p><p className="mt-1 text-xs text-stone-500">{ruleScopeSummary(t, rule)}</p></div>
        <div className="flex gap-2"><button type="button" title={t("common.edit")} onClick={() => beginRuleEdit(rule)} className="grid h-9 w-9 place-items-center rounded-md border border-stone-300"><Pencil className="h-4 w-4" /></button><button type="button" title={t("common.delete")} onClick={() => void deleteRule(rule)} className="grid h-9 w-9 place-items-center rounded-md border border-red-200 text-red-700"><Trash2 className="h-4 w-4" /></button></div>
      </article>)}</div>
      {state.rules.length === 0 ? <p className="py-4 text-sm text-stone-500">{t("print.rule.legacyHint")}</p> : null}

      {ruleEditor ? <RuleEditor
        state={state}
        draft={ruleEditor.draft}
        setDraft={(draft) => setRuleEditor((current) => current ? { ...current, draft } : current)}
        busy={busy}
        onSave={() => void saveRule()}
        onCancel={() => setRuleEditor(null)}
      /> : null}
    </section>
  </>;
}

function RuleEditor({ state, draft, setDraft, busy, onSave, onCancel }: {
  state: PrintQueueState;
  draft: PrintRuleDraft;
  setDraft: (draft: PrintRuleDraft) => void;
  busy: boolean;
  onSave: () => void;
  onCancel: () => void;
}) {
  const { t } = useOperationsLocale();
  const receipt = draft.documentType === "CUSTOMER_RECEIPT";
  const cloudPrinter = state.printers.some((printer) => (
    printer.id === draft.printerId && printer.connectionType === "CLOUDPRNT"
  ));
  const patch = (next: Partial<PrintRuleDraft>) => setDraft({ ...draft, ...next });
  return <div className="mt-4 rounded-md border-2 border-teal-200 bg-teal-50/40 p-4">
    <h3 className="font-semibold">{t("print.rule.editor")}</h3>
    <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <TextField label={t("print.rule.name")} value={draft.name} onChange={(name) => patch({ name })} />
      <SelectField label={t("print.rule.printer")} value={draft.printerId} onChange={(printerId) => patch({ printerId, ...(state.printers.some((printer) => printer.id === printerId && printer.connectionType === "CLOUDPRNT") ? { autoPrint: true } : {}) })} options={state.printers.map((printer) => ({ value: printer.id, label: printer.name }))} />
      <SelectField label={t("print.rule.document")} value={draft.documentType} onChange={(documentType) => patch({ documentType: documentType as PrintRuleDraft["documentType"], ...(documentType === "CUSTOMER_RECEIPT" ? { trigger: "PAYMENT_COMPLETED", splitMode: "NONE", productCategoryIds: [], productGroupIds: [] } : {}) })} options={[{ value: "KITCHEN_TICKET", label: t("print.rule.document.kitchen") }, { value: "CUSTOMER_RECEIPT", label: t("print.rule.document.receipt") }]} />
      <SelectField label={t("print.rule.trigger")} value={draft.trigger} onChange={(trigger) => patch({ trigger: trigger as PrintRuleDraft["trigger"] })} options={[{ value: "ORDER_CONFIRMED", label: t("print.rule.trigger.confirmed") }, { value: "PAYMENT_COMPLETED", label: t("print.rule.trigger.paid") }]} />
      <SelectField label={t("print.rule.copies")} value={String(draft.copies)} onChange={(copies) => patch({ copies: Number(copies) })} options={[1, 2, 3, 4, 5].map((value) => ({ value: String(value), label: String(value) }))} />
      <SelectField label={t("print.rule.font")} value={String(draft.fontScale)} onChange={(fontScale) => patch({ fontScale: Number(fontScale) })} options={[{ value: "1", label: t("print.rule.font.compact") }, { value: "2", label: t("print.rule.font.medium") }, { value: "3", label: t("print.rule.font.large") }]} />
      <SelectField label={t("print.rule.feedLines")} value={String(draft.feedLines)} onChange={(feedLines) => patch({ feedLines: Number(feedLines) })} options={[1, 2, 3].map((value) => ({ value: String(value), label: t("print.rule.feedLinesValue", { count: value }) }))} />
      <SelectField label={t("print.rule.split")} value={draft.splitMode} disabled={receipt} onChange={(splitMode) => patch({ splitMode: splitMode as PrintRuleDraft["splitMode"] })} options={[{ value: "NONE", label: t("print.rule.split.none") }, { value: "CATEGORY", label: t("print.rule.split.category") }, { value: "PRODUCT", label: t("print.rule.split.product") }, { value: "ITEM", label: t("print.rule.split.item") }]} />
      <label className="text-xs font-semibold text-stone-600">{t("print.rule.order")}<input type="number" min={0} max={1000} value={draft.sortOrder} onChange={(event) => patch({ sortOrder: Number(event.target.value) })} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label>
    </div>

    <div className="mt-4 grid gap-4 md:grid-cols-2">
      <CheckboxGroup title={t("print.rule.sources")} hint={t("print.rule.emptyMeansAll")} values={draft.orderSources} options={sourceOptions.map((value) => ({ value, label: sourceLabel(t, value) }))} onChange={(orderSources) => patch({ orderSources: orderSources as PrintOrderSource[] })} />
      <CheckboxGroup title={t("print.rule.fulfillment")} hint={t("print.rule.emptyMeansAll")} values={draft.fulfillmentTypes} options={fulfillmentOptions.map((value) => ({ value, label: fulfillmentLabel(t, value) }))} onChange={(fulfillmentTypes) => patch({ fulfillmentTypes: fulfillmentTypes as PrintFulfillmentType[] })} />
    </div>

    <details className="mt-4 rounded-md border border-stone-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold">{t("print.rule.advanced")}</summary>
      <div className="mt-3 grid gap-4 md:grid-cols-2">
        <CheckboxGroup title={t("print.rule.origins")} hint={t("print.rule.emptyMeansAll")} values={draft.orderOrigins} options={originOptions.map((value) => ({ value, label: originLabel(t, value) }))} onChange={(orderOrigins) => patch({ orderOrigins: orderOrigins as PrintOrderOrigin[] })} />
        <div><p className="text-xs font-semibold text-stone-600">{t("print.rule.products")}</p><p className="mt-1 text-xs text-stone-500">{receipt ? t("print.rule.receiptAllProducts") : t("print.rule.emptyMeansAllProducts")}</p><div className="mt-2 max-h-48 space-y-2 overflow-y-auto rounded border border-stone-200 p-2">{state.catalog.map((category) => <div key={category.id}><ToggleCheckbox label={category.name} checked={draft.productCategoryIds.includes(category.id)} disabled={receipt} onChange={() => patch({ productCategoryIds: toggleValue(draft.productCategoryIds, category.id) })} /><div className="ml-5 mt-1 space-y-1">{category.groups.map((group) => <ToggleCheckbox key={group.id} label={group.name} checked={draft.productGroupIds.includes(group.id)} disabled={receipt} onChange={() => patch({ productGroupIds: toggleValue(draft.productGroupIds, group.id) })} />)}</div></div>)}</div></div>
      </div>
    </details>

    <details className="mt-4 rounded-md border border-stone-200 bg-white p-3">
      <summary className="cursor-pointer text-sm font-semibold">{t("print.rule.content")}</summary>
      <p className="mt-1 text-xs text-stone-500">{t("print.rule.contentHint")}</p>
      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-3">
        {receipt ? <>
          <ToggleCheckbox label={t("print.rule.showCustomerName")} checked={draft.showCustomerName} onChange={() => patch({ showCustomerName: !draft.showCustomerName })} />
          <ToggleCheckbox label={t("print.rule.showCustomerPhone")} checked={draft.showCustomerPhone} onChange={() => patch({ showCustomerPhone: !draft.showCustomerPhone })} />
          <ToggleCheckbox label={t("print.rule.showDeliveryAddress")} checked={draft.showDeliveryAddress} onChange={() => patch({ showDeliveryAddress: !draft.showDeliveryAddress })} />
          <ToggleCheckbox label={t("print.rule.showPrices")} checked={draft.showPrices} onChange={() => patch({ showPrices: !draft.showPrices })} />
          <ToggleCheckbox label={t("print.rule.showPaymentMethod")} checked={draft.showPaymentMethod} onChange={() => patch({ showPaymentMethod: !draft.showPaymentMethod })} />
        </> : null}
        <ToggleCheckbox label={t("print.rule.showOrderNote")} checked={draft.showOrderNote} onChange={() => patch({ showOrderNote: !draft.showOrderNote })} />
        <ToggleCheckbox label={t("print.rule.showItemNotes")} checked={draft.showItemNotes} onChange={() => patch({ showItemNotes: !draft.showItemNotes })} />
      </div>
    </details>

    <div className="mt-4 flex flex-wrap gap-4">
      <ToggleCheckbox label={t("print.rule.enabled")} checked={draft.isEnabled} onChange={() => patch({ isEnabled: !draft.isEnabled })} />
      <ToggleCheckbox label={t("print.rule.auto")} checked={cloudPrinter || draft.autoPrint} disabled={cloudPrinter} onChange={() => patch({ autoPrint: !draft.autoPrint })} />
      <ToggleCheckbox label={t("print.rule.aggregate")} checked={draft.aggregateItems} onChange={() => patch({ aggregateItems: !draft.aggregateItems })} />
    </div>
    <p className="mt-2 text-xs text-stone-500">{cloudPrinter ? t("print.device.cloudAutonomous") : t("print.rule.autoHint")}</p>
    <div className="mt-4 flex gap-2"><button type="button" disabled={busy || !draft.name.trim() || !draft.printerId} onClick={onSave} className="inline-flex min-h-10 items-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40"><Save className="h-4 w-4" />{t("common.save")}</button><button type="button" onClick={onCancel} className="min-h-10 rounded-md border border-stone-300 bg-white px-4 text-sm font-semibold">{t("common.cancel")}</button></div>
  </div>;
}

function TextField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<input type="text" value={value} maxLength={80} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm" /></label>;
}

function SelectField({ label, value, options, onChange, disabled = false }: { label: string; value: string; options: Array<{ value: string; label: string }>; onChange: (value: string) => void; disabled?: boolean }) {
  return <label className="text-xs font-semibold text-stone-600">{label}<select value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm disabled:bg-stone-100">{options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function ConnectionSelect({ value, onChange }: { value: PrinterConnectionType; onChange: (value: PrinterConnectionType) => void }) {
  const { t } = useOperationsLocale();
  return <SelectField label={t("print.device.connection")} value={value} onChange={(next) => onChange(next as PrinterConnectionType)} options={[{ value: "WEBPRNT_BLUETOOTH", label: t("print.device.connection.bluetooth") }, { value: "CLOUDPRNT", label: t("print.device.connection.cloud") }, { value: "SYSTEM_PRINT", label: t("print.device.connection.system") }]} />;
}

function PaperSelect({ value, onChange }: { value: 58 | 80; onChange: (value: 58 | 80) => void }) {
  const { t } = useOperationsLocale();
  return <SelectField label={t("print.device.paper")} value={String(value)} onChange={(next) => onChange(next === "80" ? 80 : 58)} options={[{ value: "58", label: t("print.device.paper58") }, { value: "80", label: t("print.device.paper80") }]} />;
}

function CheckboxGroup({ title, hint, values, options, onChange }: { title: string; hint: string; values: string[]; options: Array<{ value: string; label: string }>; onChange: (values: string[]) => void }) {
  return <fieldset><legend className="text-xs font-semibold text-stone-600">{title}</legend><p className="mt-1 text-xs text-stone-500">{hint}</p><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{options.map((option) => <ToggleCheckbox key={option.value} label={option.label} checked={values.includes(option.value)} onChange={() => onChange(toggleValue(values, option.value))} />)}</div></fieldset>;
}

function ToggleCheckbox({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: () => void; disabled?: boolean }) {
  return <label className="inline-flex items-center gap-2 text-xs text-stone-700"><input type="checkbox" checked={checked} disabled={disabled} onChange={onChange} className="h-4 w-4 rounded border-stone-300" />{label}</label>;
}

function CloudSetupValue({ label, value, field, copiedField, onCopy, copyable = true }: {
  label: string;
  value: string;
  field: string;
  copiedField: string | null;
  onCopy: (field: string, value: string) => Promise<void>;
  copyable?: boolean;
}) {
  const { t } = useOperationsLocale();
  const copied = copiedField === field;
  return <div className="grid min-w-0 gap-1 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
    <div className="min-w-0"><p className="text-[11px] font-semibold text-stone-600">{label}</p><code className="mt-0.5 block break-all rounded bg-white/80 px-2 py-1.5 text-xs text-stone-900">{value}</code></div>
    <button type="button" disabled={!copyable} aria-label={`${t("print.cloud.copy")} ${label}`} onClick={() => void onCopy(field, value)} className="inline-flex min-h-11 items-center justify-center gap-2 rounded-md border border-stone-300 bg-white px-3 text-xs font-semibold disabled:opacity-40">{copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}{copied ? t("print.cloud.copied") : t("print.cloud.copy")}</button>
  </div>;
}

function toggleValue(values: string[], value: string) {
  return values.includes(value) ? values.filter((current) => current !== value) : [...values, value];
}

function ConnectionIcon({ type }: { type: PrinterConnectionType }) {
  if (type === "WEBPRNT_BLUETOOTH") return <Bluetooth className="h-4 w-4 shrink-0 text-blue-700" />;
  if (type === "CLOUDPRNT") return <Cloud className="h-4 w-4 shrink-0 text-teal-700" />;
  return <Cable className="h-4 w-4 shrink-0 text-stone-600" />;
}

type Translate = ReturnType<typeof useOperationsLocale>["t"];

function connectionLabel(t: Translate, value: PrinterConnectionType) { return t(value === "WEBPRNT_BLUETOOTH" ? "print.device.connection.bluetooth" : value === "CLOUDPRNT" ? "print.device.connection.cloud" : "print.device.connection.system"); }
function documentLabel(t: Translate, value: PrintRuleView["documentType"]) { return t(value === "KITCHEN_TICKET" ? "print.rule.document.kitchen" : "print.rule.document.receipt"); }
function triggerLabel(t: Translate, value: PrintRuleView["trigger"]) { return t(value === "ORDER_CONFIRMED" ? "print.rule.trigger.confirmed" : "print.rule.trigger.paid"); }
function sourceLabel(t: Translate, value: PrintOrderSource) { return t(value === "QR_MENU" ? "print.rule.source.qr" : value === "STAFF_POS" ? "print.rule.source.staff" : value === "LINE_DELIVERY" ? "print.rule.source.line" : "print.rule.source.offline"); }
function originLabel(t: Translate, value: PrintOrderOrigin) { return t(value === "ONLINE_QR" ? "print.rule.origin.qr" : value === "ONLINE_STAFF" ? "print.rule.origin.staff" : value === "OFFLINE_POS" ? "print.rule.origin.offline" : "print.rule.origin.imported"); }
function fulfillmentLabel(t: Translate, value: PrintFulfillmentType) { return t(value === "TAKEOUT" ? "kitchen.fulfillment.takeout" : value === "DINE_IN" ? "kitchen.fulfillment.dineIn" : "kitchen.fulfillment.delivery"); }
function ruleScopeSummary(t: Translate, rule: PrintRuleView) {
  const source = rule.orderSources.length === 0 ? t("print.rule.allSources") : rule.orderSources.map((value) => sourceLabel(t, value)).join("、");
  const fulfillment = rule.fulfillmentTypes.length === 0 ? t("print.rule.allFulfillment") : rule.fulfillmentTypes.map((value) => fulfillmentLabel(t, value)).join("、");
  return `${source} · ${fulfillment}`;
}
