"use client";

import { type SyntheticEvent, useMemo, useRef, useState } from "react";
import { CalendarClock, ChevronsUpDown, Copy, Dices, Languages, MapPinned, MessageCircle, Percent, Plus, Printer, QrCode, RotateCw, Save, SlidersHorizontal, Trash2, Truck, Utensils, WalletCards } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { CollapsibleSectionSummary } from "@/components/collapsible-section-summary";
import { DiningFloorEditor } from "@/components/dining-floor-editor";
import { LocaleFlag } from "@/components/locale-flag";
import { csrfHeaders } from "@/lib/csrf-client";
import {
  DEFAULT_DINING_FLOOR_NAME,
  DINING_TABLE_SHAPES,
  diningTableShapeLabels,
  getDiningFloorTabs,
  getUnsavedDiningTableFloorMoves,
  type DiningTableShape,
} from "@/lib/dining-floor";
import { QR_LOCALES, type QrLocale } from "@/lib/qr-order-i18n";
import { normalizeDisabledModuleSettings } from "@/lib/stall-module-contract";
import { useUnsavedSettings } from "@/lib/unsaved-settings";

const QR_LOCALE_LABELS: Record<QrLocale, string> = {
  "zh-TW": "繁體中文",
  en: "英文",
  ja: "日文",
  ko: "韓文",
  vi: "越南文",
  th: "泰文",
};

export type ModuleState = {
  settings: {
    dineInEnabled: boolean;
    deliveryModuleEnabled: boolean;
    staffDeliveryEnabled: boolean;
    printModuleEnabled: boolean;
    paymentModuleEnabled: boolean;
    discountModuleEnabled: boolean;
    discountApprovalThresholdBps: number;
    takeoutPreorderEnabled: boolean;
    preorderMinLeadMinutes: number;
    preorderMaxDays: number;
    preorderSlotMinutes: 5 | 15 | 30 | 60 | 120;
    lotteryEnabled: boolean;
    lotteryDiscountOptionId: string | null;
    lotteryDiscountWinRateBps: number;
    lotteryDiscountChances: Array<{
      discountOptionId: string;
      winRateBps: number;
    }>;
    enabledLocales: QrLocale[];
  };
  floors: Array<{
    id: string;
    name: string;
    sortOrder: number;
  }>;
  tables: Array<{
    id: string;
    floorId: string | null;
    code: string;
    label: string;
    isActive: boolean;
    sortOrder: number;
    layoutX: number;
    layoutY: number;
    shape: DiningTableShape;
    rotationDegrees: number;
    qrCode: { token: string; tokenVersion: number } | null;
  }>;
  paymentOptions: Array<{
    id: string;
    code: string;
    name: string;
    kind: "CASH" | "LINE_PAY" | "JKO_PAY" | "CUSTOM";
    isEnabled: boolean;
    sortOrder: number;
  }>;
  discounts: Array<{
    id: string;
    name: string;
    rateBps: number;
    isEnabled: boolean;
    sortOrder: number;
  }>;
};

type TableDraft = Omit<ModuleState["tables"][number], "id" | "qrCode" | "layoutX" | "layoutY">;
type FloorDraft = Omit<ModuleState["floors"][number], "id">;
type PaymentDraft = Omit<ModuleState["paymentOptions"][number], "id">;
type DiscountDraft = Omit<ModuleState["discounts"][number], "id">;
const moduleSectionKeys = [
  "overview",
  "delivery",
  "locales",
  "tables",
  "floor",
  "payments",
  "discounts",
] as const;
type ModuleSectionKey = (typeof moduleSectionKeys)[number];
const moduleSectionControlIds = moduleSectionKeys.map((section) => (
  section === "payments"
    ? "payment-options"
    : section === "discounts"
      ? "discount-options"
      : `stall-module-section-${section}`
)).join(" ");
type MessageKind = "success" | "error";

export function StallModulesManager({
  stallId,
  stallSlug,
  appUrl,
  initialState,
}: {
  stallId: string;
  stallSlug: string;
  appUrl: string;
  initialState: ModuleState;
}) {
  const [state, setState] = useState(initialState);
  const [savedState, setSavedState] = useState(initialState);
  const initialFloorTabs = getDiningFloorTabs(initialState.floors, initialState.tables);
  const initialNewFloorNumber = Math.max(2, initialState.floors.length + 1);
  const [activeFloorKey, setActiveFloorKey] = useState(initialFloorTabs[0]?.key ?? "");
  const [newFloor, setNewFloor] = useState<FloorDraft>({ name: `${initialNewFloorNumber}樓`, sortOrder: initialNewFloorNumber });
  const [newTable, setNewTable] = useState<TableDraft>({
    floorId: initialFloorTabs[0]?.id ?? null,
    code: "",
    label: "",
    isActive: true,
    sortOrder: initialState.tables.length + 1,
    shape: "SQUARE",
    rotationDegrees: 0,
  });
  const [newPayment, setNewPayment] = useState<PaymentDraft>({ code: "", name: "", kind: "CUSTOM", isEnabled: true, sortOrder: initialState.paymentOptions.length + 1 });
  const [newDiscount, setNewDiscount] = useState<DiscountDraft>({ name: "", rateBps: 9000, isEnabled: true, sortOrder: initialState.discounts.length + 1 });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [messageKind, setMessageKind] = useState<MessageKind>("success");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const managerRef = useRef<HTMLElement>(null);
  const [openSections, setOpenSections] = useState<Set<ModuleSectionKey>>(
    () => new Set(moduleSectionKeys),
  );
  const allSectionsExpanded = moduleSectionKeys.every((section) => openSections.has(section));
  const deliveryUrl = `${appUrl.replace(/\/$/, "")}/delivery/${encodeURIComponent(stallSlug)}`;
  const lineReply = `您好，請點擊以下連結選擇餐點並填寫外送資料：\n${deliveryUrl}`;
  const floorTabs = useMemo(() => getDiningFloorTabs(state.floors, state.tables), [state.floors, state.tables]);
  const activeFloor = floorTabs.find((floor) => floor.key === activeFloorKey) ?? floorTabs[0] ?? null;
  const activeFloorRecord = activeFloor?.id ? state.floors.find((floor) => floor.id === activeFloor.id) ?? null : null;
  const activeFloorTables = state.tables.filter((table) => table.floorId === (activeFloor?.id ?? null));
  const unsavedFloorMoves = getUnsavedDiningTableFloorMoves(state.tables, savedState.tables);
  const pendingFloorMoveMessage = unsavedFloorMoves.length > 0
    ? `請先儲存「${unsavedFloorMoves.map((table) => table.label).join("、")}」的樓層變更，再儲存桌位位置。`
    : "";
  const lotteryDiscountChances = state.settings.lotteryDiscountChances ?? [];
  const lotteryChanceByDiscountId = new Map(
    lotteryDiscountChances.map((chance) => [chance.discountOptionId, chance]),
  );
  const lotteryChanceTotalBps = lotteryDiscountChances.reduce(
    (total, chance) => total + chance.winRateBps,
    0,
  );
  const lotteryNoDiscountRateBps = Math.max(0, 10_000 - lotteryChanceTotalBps);
  const moduleDirty = JSON.stringify(state) !== JSON.stringify(savedState)
    || Boolean(newTable.code || newTable.label || newPayment.code || newPayment.name || newDiscount.name);
  useUnsavedSettings("stall-modules", moduleDirty);

  function handleSectionToggle(
    section: ModuleSectionKey,
    event: SyntheticEvent<HTMLDetailsElement>,
  ) {
    const isOpen = event.currentTarget.open;
    setOpenSections((current) => {
      if (current.has(section) === isOpen) return current;
      const next = new Set(current);
      if (isOpen) next.add(section);
      else next.delete(section);
      return next;
    });
  }

  function setAllSections(isOpen: boolean) {
    setOpenSections(isOpen ? new Set(moduleSectionKeys) : new Set());
  }

  async function run(command: Record<string, unknown>, success: string) {
    const scope = commandFieldScope(command);
    setBusy(true);
    setMessage("");
    setFieldErrors((current) => omitScopeErrors(current, scope));
    try {
      const response = await fetch(`/api/merchant/stalls/${stallId}/modules`, {
        method: "PATCH",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json();
      if (!response.ok) {
        const nextFieldErrors = parseFieldErrors(payload.fieldErrors);
        setFieldErrors((current) => ({
          ...omitScopeErrors(current, scope),
          ...Object.fromEntries(Object.entries(nextFieldErrors).map(([field, error]) => [fieldKey(scope, field), error])),
        }));
        setMessage(payload.error ?? "目前無法更新模組設定。");
        setMessageKind("error");
        focusFirstInvalidField(managerRef.current, scope, nextFieldErrors);
        return false;
      }
      const nextState = payload.state as ModuleState;
      const mergedState = mergeModuleStateAfterCommand(state, savedState, nextState, command);
      const nextFloorTabs = getDiningFloorTabs(mergedState.floors, mergedState.tables);
      setState(mergedState);
      setSavedState(nextState);
      setActiveFloorKey((current) => (
        nextFloorTabs.some((floor) => floor.key === current) ? current : nextFloorTabs[0]?.key ?? ""
      ));
      setNewTable((current) => {
        const stillAvailable = nextFloorTabs.some((floor) => floor.id === current.floorId);
        return stillAvailable ? current : { ...current, floorId: nextFloorTabs[0]?.id ?? null };
      });
      setMessage(success);
      setMessageKind("success");
      return mergedState;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法更新模組設定。");
      setMessageKind("error");
      return false;
    } finally {
      setBusy(false);
    }
  }

  function errorFor(scope: string, field: string) {
    return fieldErrors[fieldKey(scope, field)];
  }

  function updateTable(id: string, changes: Partial<ModuleState["tables"][number]>) {
    setState((current) => ({ ...current, tables: current.tables.map((table) => table.id === id ? { ...table, ...changes } : table) }));
  }

  function updateFloor(id: string, changes: Partial<ModuleState["floors"][number]>) {
    setState((current) => ({ ...current, floors: current.floors.map((floor) => floor.id === id ? { ...floor, ...changes } : floor) }));
  }

  function updatePayment(id: string, changes: Partial<ModuleState["paymentOptions"][number]>) {
    setState((current) => ({ ...current, paymentOptions: current.paymentOptions.map((option) => option.id === id ? { ...option, ...changes } : option) }));
  }

  function updateDiscount(id: string, changes: Partial<ModuleState["discounts"][number]>) {
    setState((current) => ({ ...current, discounts: current.discounts.map((discount) => discount.id === id ? { ...discount, ...changes } : discount) }));
  }

  function setLotteryDiscountEnabled(discountOptionId: string, enabled: boolean) {
    setState((current) => {
      const currentChances = current.settings.lotteryDiscountChances ?? [];
      if (!enabled) {
        return {
          ...current,
          settings: {
            ...current.settings,
            lotteryDiscountChances: currentChances.filter(
              (chance) => chance.discountOptionId !== discountOptionId,
            ),
          },
        };
      }
      const remainingBps = Math.max(
        0,
        10_000 - currentChances.reduce((total, chance) => total + chance.winRateBps, 0),
      );
      if (remainingBps === 0 || currentChances.some((chance) => chance.discountOptionId === discountOptionId)) {
        return current;
      }
      return {
        ...current,
        settings: {
          ...current.settings,
          lotteryDiscountChances: [
            ...currentChances,
            { discountOptionId, winRateBps: Math.min(1_000, remainingBps) },
          ],
        },
      };
    });
  }

  function updateLotteryDiscountChance(discountOptionId: string, winRateBps: number) {
    setState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        lotteryDiscountChances: (current.settings.lotteryDiscountChances ?? []).map((chance) => (
          chance.discountOptionId === discountOptionId ? { ...chance, winRateBps } : chance
        )),
      },
    }));
  }

  async function saveModules() {
    const settings = normalizeDisabledModuleSettings(state.settings);
    const firstLotteryDiscount = settings.lotteryDiscountChances?.[0] ?? null;
    await run({
      operation: "UPDATE_MODULES",
      dineInEnabled: settings.dineInEnabled,
      deliveryModuleEnabled: settings.deliveryModuleEnabled,
      staffDeliveryEnabled: settings.staffDeliveryEnabled,
      printModuleEnabled: settings.printModuleEnabled,
      paymentModuleEnabled: settings.paymentModuleEnabled,
      discountModuleEnabled: settings.discountModuleEnabled,
      discountApprovalThresholdBps: settings.discountApprovalThresholdBps,
      takeoutPreorderEnabled: settings.takeoutPreorderEnabled,
      preorderMinLeadMinutes: settings.preorderMinLeadMinutes,
      preorderMaxDays: settings.preorderMaxDays,
      preorderSlotMinutes: settings.preorderSlotMinutes,
      lotteryEnabled: settings.lotteryEnabled,
      lotteryDiscountOptionId: firstLotteryDiscount?.discountOptionId ?? null,
      lotteryDiscountWinRateBps: firstLotteryDiscount?.winRateBps ?? 0,
      lotteryDiscountChances: settings.lotteryDiscountChances ?? [],
    }, "模組開關已儲存。");
  }

  async function saveLocales() {
    await run(
      { operation: "UPDATE_LOCALES", enabledLocales: state.settings.enabledLocales },
      "QR 點餐語系已儲存。",
    );
  }

  async function saveTableLayout() {
    if (!activeFloor || activeFloorTables.length === 0) return;
    if (pendingFloorMoveMessage) {
      setMessage(pendingFloorMoveMessage);
      setMessageKind("error");
      return;
    }
    await run({
      operation: "UPDATE_TABLE_LAYOUT",
      floorId: activeFloor.id,
      tables: activeFloorTables.map((table) => ({
        tableId: table.id,
        layoutX: table.layoutX,
        layoutY: table.layoutY,
      })),
    }, "桌位平面配置已儲存。");
  }

  function updateLocale(locale: QrLocale, enabled: boolean) {
    if (locale === "zh-TW") return;
    setState((current) => ({
      ...current,
      settings: {
        ...current.settings,
        enabledLocales: enabled
          ? QR_LOCALES.filter((candidate) => (
            candidate === locale || current.settings.enabledLocales.includes(candidate)
          ))
          : current.settings.enabledLocales.filter((candidate) => candidate !== locale),
      },
    }));
  }

  return (
    <section ref={managerRef} className="mt-8" aria-label="營運模組與內用桌位">
      <div className="mb-3 flex justify-end">
        <button
          type="button"
          data-testid="stall-modules-toggle-all"
          aria-expanded={allSectionsExpanded}
          aria-controls={moduleSectionControlIds}
          onClick={() => setAllSections(!allSectionsExpanded)}
          className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"
        >
          <ChevronsUpDown className="h-4 w-4" />
          {allSectionsExpanded ? "全部摺疊" : "全部展開"}
        </button>
      </div>
      <details
        id="stall-module-section-overview"
        open={openSections.has("overview")}
        onToggle={(event) => handleSectionToggle("overview", event)}
        data-module-section="overview"
        data-settings-section
        data-settings-scope="stall-modules"
        data-settings-search="營運模組 內用桌位 外送 LINE 專屬 QR 點餐語系 訂單列印 付款方式 結帳折扣 桌位平面配置"
        className="border-y border-stone-200 data-[dirty=true]:border-l-2 data-[dirty=true]:border-l-amber-500 [&[open]>summary_.section-chevron]:rotate-180"
      >
        <CollapsibleSectionSummary
          icon={SlidersHorizontal}
          title="營運模組與內用桌位"
          description={moduleDirty ? "有尚未儲存的變更" : "模組關閉後保留既有資料與歷史對帳，不會刪除紀錄。"}
        />
        <div className="pb-7">

      <div data-module-switch-grid className="mt-5 grid gap-3 sm:grid-cols-2">
        <ModuleSwitch label="內用桌位" icon={<Utensils className="h-4 w-4" />} checked={state.settings.dineInEnabled} onChange={(dineInEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, dineInEnabled } }))} />
        <ModuleSwitch label="線上外送" icon={<Truck className="h-4 w-4" />} checked={state.settings.deliveryModuleEnabled} onChange={(deliveryModuleEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, deliveryModuleEnabled } }))} />
        <ModuleSwitch label="店員外送點餐" icon={<Truck className="h-4 w-4" />} checked={state.settings.staffDeliveryEnabled} onChange={(staffDeliveryEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, staffDeliveryEnabled } }))} />
        <ModuleSwitch label="訂單列印" icon={<Printer className="h-4 w-4" />} checked={state.settings.printModuleEnabled} onChange={(printModuleEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, printModuleEnabled } }))} />
        <ModuleSwitch label="多元付款" icon={<WalletCards className="h-4 w-4" />} checked={state.settings.paymentModuleEnabled} onChange={(paymentModuleEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, paymentModuleEnabled } }))} />
        <ModuleSwitch label="結帳折扣" icon={<Percent className="h-4 w-4" />} checked={state.settings.discountModuleEnabled} onChange={(discountModuleEnabled) => setState((current) => ({ ...current, settings: { ...current.settings, discountModuleEnabled } }))} />
        <ModuleSwitch label="外帶預約單" icon={<CalendarClock className="h-4 w-4" />} checked={state.settings.takeoutPreorderEnabled} onChange={(takeoutPreorderEnabled) => setState((current) => ({ ...current, settings: normalizeDisabledModuleSettings({ ...current.settings, takeoutPreorderEnabled }) }))} />
        <ModuleSwitch label="抽抽樂推薦" icon={<Dices className="h-4 w-4" />} checked={state.settings.lotteryEnabled} onChange={(lotteryEnabled) => setState((current) => ({ ...current, settings: normalizeDisabledModuleSettings({ ...current.settings, lotteryEnabled }) }))} />
      </div>
      {state.settings.takeoutPreorderEnabled ? <div className="mt-4 grid gap-3 rounded-lg border border-stone-200 p-4 sm:grid-cols-3">
        <NumberInput label="最少提前（分鐘）" value={state.settings.preorderMinLeadMinutes} fieldKey={fieldKey("modules", "preorderMinLeadMinutes")} error={errorFor("modules", "preorderMinLeadMinutes")} min={15} max={1440} onChange={(preorderMinLeadMinutes) => setState((current) => ({ ...current, settings: { ...current.settings, preorderMinLeadMinutes } }))} />
        <NumberInput label="最多預約天數" value={state.settings.preorderMaxDays} fieldKey={fieldKey("modules", "preorderMaxDays")} error={errorFor("modules", "preorderMaxDays")} min={1} max={30} onChange={(preorderMaxDays) => setState((current) => ({ ...current, settings: { ...current.settings, preorderMaxDays } }))} />
        <label className="text-xs font-medium text-stone-600">時段間隔<select {...validationAttributes(fieldKey("modules", "preorderSlotMinutes"), errorFor("modules", "preorderSlotMinutes"))} value={state.settings.preorderSlotMinutes} onChange={(event) => setState((current) => ({ ...current, settings: { ...current.settings, preorderSlotMinutes: Number(event.target.value) as 5 | 15 | 30 | 60 | 120 } }))} className={`${inputClass(errorFor("modules", "preorderSlotMinutes"))} bg-white`}><option value={5}>5 分鐘</option><option value={15}>15 分鐘</option><option value={30}>30 分鐘</option><option value={60}>60 分鐘</option><option value={120}>120 分鐘</option></select><FieldError fieldKey={fieldKey("modules", "preorderSlotMinutes")} error={errorFor("modules", "preorderSlotMinutes")} /></label>
        <p className="text-xs text-stone-500 sm:col-span-3">關店期間只接受營業時間內的合法外帶時段；暫停接單與售罄仍會阻擋預約。</p>
      </div> : null}
      {state.settings.lotteryEnabled ? <fieldset className="mt-4 rounded-lg border border-stone-200 p-4">
        <legend className="px-1 text-sm font-semibold text-stone-800">抽抽樂折扣獎項</legend>
        <p className="text-xs leading-5 text-stone-500">商品推薦依近 30 天已完成訂單的熱銷排行加權，並保留探索其他可抽商品的機會；折扣獎項會依下方設定的機率獨立抽取。</p>
        <div
          {...validationAttributes(fieldKey("modules", "lotteryDiscountChances"), errorFor("modules", "lotteryDiscountChances"))}
          tabIndex={-1}
          className="mt-3 divide-y divide-stone-200 rounded-md border border-stone-200"
        >
          {state.discounts.filter((discount) => discount.isEnabled).map((discount) => {
            const chance = lotteryChanceByDiscountId.get(discount.id);
            const checkboxId = `lottery-discount-${discount.id}`;
            return <div key={discount.id} data-testid={`lottery-discount-row-${discount.id}`} className="grid gap-3 p-3 sm:grid-cols-[minmax(0,1fr)_140px] sm:items-center">
              <label htmlFor={checkboxId} className="flex min-h-11 items-center gap-3 text-sm font-semibold text-stone-800">
                <input
                  id={checkboxId}
                  type="checkbox"
                  aria-label={`${discount.name}，付款比例 ${formatPercentage(discount.rateBps)}`}
                  checked={Boolean(chance)}
                  disabled={!chance && lotteryNoDiscountRateBps === 0}
                  onChange={(event) => setLotteryDiscountEnabled(discount.id, event.target.checked)}
                  className="h-5 w-5 shrink-0"
                />
                <span className="min-w-0"><span className="block truncate">{discount.name}</span><span className="block text-xs font-normal text-stone-500">付款比例 {formatPercentage(discount.rateBps)}</span></span>
              </label>
              <label className="text-xs font-medium text-stone-600">中獎率（%）
                <input
                  type="number"
                  aria-label={`${discount.name} 中獎率（%）`}
                  data-testid={`lottery-discount-rate-${discount.id}`}
                  min={0.01}
                  max={100}
                  step={0.01}
                  disabled={!chance}
                  value={chance ? chance.winRateBps / 100 : 0}
                  onChange={(event) => updateLotteryDiscountChance(
                    discount.id,
                    Math.round(Number(event.target.value) * 100),
                  )}
                  className={`mt-1 h-11 w-full rounded-md border px-2 text-sm disabled:bg-stone-100 disabled:text-stone-400 ${errorFor("modules", "lotteryDiscountChances") ? "border-red-500 bg-red-50" : "border-stone-300"}`}
                />
              </label>
            </div>;
          })}
          {state.discounts.every((discount) => !discount.isEnabled) ? <p className="p-3 text-sm text-amber-800">請先在下方「結帳折扣」新增並啟用折扣；也可以維持只推薦商品、不發折扣。</p> : null}
        </div>
        <FieldError fieldKey={fieldKey("modules", "lotteryDiscountChances")} error={errorFor("modules", "lotteryDiscountChances")} />
        <div className={`mt-3 flex flex-wrap justify-between gap-2 rounded-md px-3 py-2 text-sm font-semibold ${lotteryChanceTotalBps > 10_000 ? "bg-red-50 text-red-800" : "bg-teal-50 text-teal-900"}`}>
          <span>折扣中獎率合計 {formatPercentage(lotteryChanceTotalBps)}</span>
          <span>未中獎／只推薦 {formatPercentage(lotteryNoDiscountRateBps)}</span>
        </div>
        <p className="mt-3 text-xs text-stone-500">每台裝置每天一次；商品與折扣由伺服器抽取，下單時一次性兌換且不可與其他折扣疊加。</p>
      </fieldset> : null}
      {state.settings.discountModuleEnabled ? <label className="mt-4 block max-w-xs text-xs font-semibold text-stone-600">超過此折扣需經理核准（%）<input {...validationAttributes(fieldKey("modules", "discountApprovalThresholdBps"), errorFor("modules", "discountApprovalThresholdBps"))} type="number" min={0} max={100} step={1} value={(10_000 - state.settings.discountApprovalThresholdBps) / 100} onChange={(event) => { const percent = Math.max(0, Math.min(100, Number(event.target.value) || 0)); setState((current) => ({ ...current, settings: { ...current.settings, discountApprovalThresholdBps: 10_000 - percent * 100 } })); }} className={inputClass(errorFor("modules", "discountApprovalThresholdBps"))} /><FieldError fieldKey={fieldKey("modules", "discountApprovalThresholdBps")} error={errorFor("modules", "discountApprovalThresholdBps")} /><span className="mt-1 block font-normal text-stone-500">例如設定 20%，折扣超過 20%（低於 8 折）時需要經理驗證。</span></label> : null}
      <button type="button" disabled={busy} onClick={() => void saveModules()} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存模組開關</button>

      <details
        id="stall-module-section-delivery"
        open={openSections.has("delivery")}
        onToggle={(event) => handleSectionToggle("delivery", event)}
        data-module-section="delivery"
        className="mt-8 border-y border-stone-200 [&[open]>summary_.section-chevron]:rotate-180"
      >
        <CollapsibleSectionSummary icon={Truck} title="外送與 LINE 連結" description="固定網址可放入 LINE 官方帳號的關鍵字自動回覆。" level={3} />
        <div className="pb-6">
          {!state.settings.deliveryModuleEnabled ? <p className="mb-3 text-sm text-amber-800">請先開啟並儲存「線上外送」模組，顧客才能使用此連結。</p> : null}
          <label className="block text-xs font-semibold text-stone-600">顧客外送網址<div className="mt-1 flex gap-2"><input type="text" readOnly value={deliveryUrl} className="h-11 min-w-0 flex-1 rounded-md border border-stone-300 bg-stone-50 px-3 text-sm" /><button type="button" title="複製外送網址" onClick={() => void navigator.clipboard.writeText(deliveryUrl)} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"><Copy className="h-4 w-4" /></button></div></label>
          <label className="mt-4 block text-xs font-semibold text-stone-600">LINE 自動回覆內容<textarea readOnly value={lineReply} className="mt-1 min-h-24 w-full rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm" /></label>
          <button type="button" onClick={() => void navigator.clipboard.writeText(lineReply)} className="mt-3 inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><MessageCircle className="h-4 w-4" />複製 LINE 回覆內容</button>
        </div>
      </details>

      <details
        id="stall-module-section-locales"
        open={openSections.has("locales")}
        onToggle={(event) => handleSectionToggle("locales", event)}
        data-module-section="locales"
        aria-label="QR 點餐語系"
        className="mt-8 border-y border-stone-200 [&[open]>summary_.section-chevron]:rotate-180"
      >
        <CollapsibleSectionSummary icon={Languages} title="QR 點餐語系" level={3} />
        <div className="pb-6">
          <p className="mb-3 text-sm text-stone-600">只向顧客提供已開啟的語系；瀏覽器語言若已關閉，會自動改用繁體中文。</p>
          <div data-locale-switch-grid className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {QR_LOCALES.map((locale) => (
              <ModuleSwitch
                key={locale}
                icon={<LocaleFlag locale={locale} />}
                label={`${QR_LOCALE_LABELS[locale]}${locale === "zh-TW" ? "（預設）" : ""}`}
                checked={state.settings.enabledLocales.includes(locale)}
                disabled={locale === "zh-TW"}
                onChange={(enabled) => updateLocale(locale, enabled)}
              />
            ))}
          </div>
          <button type="button" disabled={busy} onClick={() => void saveLocales()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存語系設定</button>
        </div>
      </details>

      <details
        id="stall-module-section-tables"
        open={openSections.has("tables")}
        onToggle={(event) => handleSectionToggle("tables", event)}
        data-module-section="tables"
        className="border-b border-stone-200 [&[open]>summary_.section-chevron]:rotate-180"
      >
        <CollapsibleSectionSummary icon={QrCode} title="內用桌位與專屬 QR" level={3} />
        <div className="pb-6">
          <div className="mb-5 border-b border-stone-200 pb-5">
            <div role="tablist" aria-label="樓層" className="flex gap-2 overflow-x-auto pb-2">
              {floorTabs.map((floor) => (
                <button
                  key={floor.key}
                  type="button"
                  role="tab"
                  aria-selected={floor.key === activeFloor?.key}
                  onClick={() => {
                    setActiveFloorKey(floor.key);
                    setNewTable((current) => ({ ...current, floorId: floor.id }));
                  }}
                  className={`min-h-10 shrink-0 rounded-md border px-4 text-sm font-semibold ${floor.key === activeFloor?.key ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-700"}`}
                >
                  {floor.name}
                </button>
              ))}
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_90px_auto] sm:items-end">
              <TextInput label="新增樓層名稱" value={newFloor.name} fieldKey={fieldKey("new-floor", "name")} error={errorFor("new-floor", "name")} maxLength={40} onChange={(name) => setNewFloor({ ...newFloor, name })} />
              <NumberInput label="排序" value={newFloor.sortOrder} fieldKey={fieldKey("new-floor", "sortOrder")} error={errorFor("new-floor", "sortOrder")} onChange={(sortOrder) => setNewFloor({ ...newFloor, sortOrder })} />
              <button type="button" data-testid="create-dining-floor" disabled={busy} onClick={async () => {
                const createdName = newFloor.name.trim();
                const nextState = await run({ operation: "CREATE_FLOOR", ...newFloor }, "樓層已新增。");
                if (nextState) {
                  const createdFloor = nextState.floors.find((floor) => floor.name === createdName);
                  if (createdFloor) {
                    setActiveFloorKey(createdFloor.id);
                    setNewTable((current) => ({ ...current, floorId: createdFloor.id }));
                  }
                  setNewFloor({ name: `${nextState.floors.length + 1}樓`, sortOrder: nextState.floors.length + 1 });
                }
              }} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />新增樓層</button>
            </div>
            {activeFloorRecord ? (
              <div className="mt-3 grid gap-2 rounded-md bg-stone-50 p-3 sm:grid-cols-[1fr_90px_auto] sm:items-end">
                <TextInput label="目前樓層名稱" value={activeFloorRecord.name} fieldKey={fieldKey(`floor-${activeFloorRecord.id}`, "name")} error={errorFor(`floor-${activeFloorRecord.id}`, "name")} maxLength={40} onChange={(name) => updateFloor(activeFloorRecord.id, { name })} />
                <NumberInput label="排序" value={activeFloorRecord.sortOrder} fieldKey={fieldKey(`floor-${activeFloorRecord.id}`, "sortOrder")} error={errorFor(`floor-${activeFloorRecord.id}`, "sortOrder")} onChange={(sortOrder) => updateFloor(activeFloorRecord.id, { sortOrder })} />
                <div className="flex gap-2">
                  <button type="button" title={`儲存 ${activeFloorRecord.name}`} disabled={busy} onClick={() => void run({ operation: "UPDATE_FLOOR", floorId: activeFloorRecord.id, name: activeFloorRecord.name, sortOrder: activeFloorRecord.sortOrder }, "樓層已儲存。")} className="grid h-10 w-10 place-items-center rounded-md bg-stone-900 text-white"><Save className="h-4 w-4" /></button>
                  <button type="button" title={`刪除 ${activeFloorRecord.name}`} disabled={busy} onClick={() => { if (window.confirm(`確定刪除 ${activeFloorRecord.name}？樓層必須沒有桌位。`)) void run({ operation: "DELETE_FLOOR", floorId: activeFloorRecord.id }, "樓層已刪除。"); }} className="grid h-10 w-10 place-items-center rounded-md border border-red-300 text-red-700"><Trash2 className="h-4 w-4" /></button>
                </div>
              </div>
            ) : <p className="mt-3 text-xs text-stone-500">目前顯示相容舊資料的虛擬 {DEFAULT_DINING_FLOOR_NAME}；首次新增桌位或儲存位置時會自動建立樓層。</p>}
          </div>
          <details
            id="stall-module-section-floor"
            open={openSections.has("floor")}
            onToggle={(event) => handleSectionToggle("floor", event)}
            data-module-section="floor"
            className="mb-6 border-b border-stone-200 [&[open]>summary_.section-chevron]:rotate-180"
          >
            <CollapsibleSectionSummary icon={MapPinned} title="桌位平面配置" description="此位置會同步到員工手機的桌位看板。" level={4} />
            <div className="pb-6">
            <DiningFloorEditor
              tables={activeFloorTables}
              disabled={busy}
              onMove={(tableId, position) => updateTable(tableId, position)}
            />
            <button type="button" disabled={busy || activeFloorTables.length === 0 || Boolean(pendingFloorMoveMessage)} title={pendingFloorMoveMessage || undefined} onClick={() => void saveTableLayout()} className="mt-4 inline-flex min-h-10 items-center gap-2 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50"><Save className="h-4 w-4" />儲存桌位位置</button>
            <FieldError fieldKey={fieldKey("table-layout", "tables")} error={pendingFloorMoveMessage || errorFor("table-layout", "tables")} />
            </div>
          </details>
          <div className="grid gap-2 border-b border-stone-200 pb-4 sm:grid-cols-2 lg:grid-cols-[120px_1fr_120px_120px_90px_auto]">
            <TextInput label="桌位代碼" value={newTable.code} fieldKey={fieldKey("new-table", "code")} error={errorFor("new-table", "code")} maxLength={20} pattern="[A-Za-z0-9-]+" onChange={(code) => setNewTable({ ...newTable, code: code.toUpperCase() })} />
            <TextInput label="顯示名稱" value={newTable.label} fieldKey={fieldKey("new-table", "label")} error={errorFor("new-table", "label")} maxLength={40} onChange={(label) => setNewTable({ ...newTable, label })} />
            <TableShapeSelect value={newTable.shape} fieldKey={fieldKey("new-table", "shape")} error={errorFor("new-table", "shape")} onChange={(shape) => setNewTable({ ...newTable, shape })} />
            <TableRotationSelect value={newTable.rotationDegrees} fieldKey={fieldKey("new-table", "rotationDegrees")} error={errorFor("new-table", "rotationDegrees")} onChange={(rotationDegrees) => setNewTable({ ...newTable, rotationDegrees })} />
            <NumberInput label="排序" value={newTable.sortOrder} fieldKey={fieldKey("new-table", "sortOrder")} error={errorFor("new-table", "sortOrder")} onChange={(sortOrder) => setNewTable({ ...newTable, sortOrder })} />
            <button type="button" disabled={busy} onClick={async () => {
              const nextState = await run({ operation: "CREATE_TABLE", ...newTable }, "桌位與專屬 QR 已建立。");
              if (nextState) {
                const nextFloorId = newTable.floorId ?? nextState.floors.find((floor) => floor.name === DEFAULT_DINING_FLOOR_NAME)?.id ?? null;
                if (nextFloorId) setActiveFloorKey(nextFloorId);
                setNewTable({ floorId: nextFloorId, code: "", label: "", isActive: true, sortOrder: nextState.tables.length + 1, shape: "SQUARE", rotationDegrees: 0 });
              }
            }} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />新增</button>
            <div className="sm:col-span-2 lg:col-span-6"><FloorSelect floors={floorTabs} value={newTable.floorId} fieldKey={fieldKey("new-table", "floorId")} error={errorFor("new-table", "floorId")} onChange={(floorId) => setNewTable({ ...newTable, floorId })} /></div>
          </div>
          <div className="divide-y divide-stone-200">
            {activeFloorTables.map((table) => {
              const qrUrl = table.qrCode ? `${appUrl.replace(/\/$/, "")}/q/${encodeURIComponent(table.qrCode.token)}` : "";
              return <div key={table.id} className="grid gap-4 py-5 lg:grid-cols-[1fr_160px]">
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[120px_1fr_120px_120px_90px]">
                  <TextInput label="桌位代碼" value={table.code} fieldKey={fieldKey(`table-${table.id}`, "code")} error={errorFor(`table-${table.id}`, "code")} maxLength={20} pattern="[A-Za-z0-9-]+" onChange={(code) => updateTable(table.id, { code: code.toUpperCase() })} />
                  <TextInput label="顯示名稱" value={table.label} fieldKey={fieldKey(`table-${table.id}`, "label")} error={errorFor(`table-${table.id}`, "label")} maxLength={40} onChange={(label) => updateTable(table.id, { label })} />
                  <TableShapeSelect value={table.shape} fieldKey={fieldKey(`table-${table.id}`, "shape")} error={errorFor(`table-${table.id}`, "shape")} onChange={(shape) => updateTable(table.id, { shape })} />
                  <TableRotationSelect value={table.rotationDegrees} fieldKey={fieldKey(`table-${table.id}`, "rotationDegrees")} error={errorFor(`table-${table.id}`, "rotationDegrees")} onChange={(rotationDegrees) => updateTable(table.id, { rotationDegrees })} />
                  <NumberInput label="排序" value={table.sortOrder} fieldKey={fieldKey(`table-${table.id}`, "sortOrder")} error={errorFor(`table-${table.id}`, "sortOrder")} onChange={(sortOrder) => updateTable(table.id, { sortOrder })} />
                  <div className="sm:col-span-2 lg:col-span-5"><FloorSelect floors={floorTabs} value={table.floorId} fieldKey={fieldKey(`table-${table.id}`, "floorId")} error={errorFor(`table-${table.id}`, "floorId")} onChange={(floorId) => updateTable(table.id, { floorId })} /></div>
                  <label className="flex min-h-10 items-center gap-2 text-sm sm:col-span-2 lg:col-span-5"><input type="checkbox" checked={table.isActive} onChange={(event) => updateTable(table.id, { isActive: event.target.checked })} />啟用桌位</label>
                  <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-5">
                    <button type="button" disabled={busy} onClick={() => void run({ operation: "UPDATE_TABLE", tableId: table.id, floorId: table.floorId, code: table.code, label: table.label, sortOrder: table.sortOrder, isActive: table.isActive, shape: table.shape, rotationDegrees: table.rotationDegrees }, `${table.label} 已儲存。`)} className="inline-flex h-10 items-center gap-2 rounded-md bg-stone-900 px-3 text-sm font-semibold text-white"><Save className="h-4 w-4" />儲存</button>
                    <button type="button" disabled={busy} onClick={() => { if (window.confirm(`確定輪替 ${table.label} 的 QR？舊 QR 將立即失效。`)) void run({ operation: "ROTATE_TABLE_QR", tableId: table.id }, "桌位 QR 已輪替。"); }} className="inline-flex h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><RotateCw className="h-4 w-4" />輪替 QR</button>
                    <button type="button" disabled={busy} onClick={() => { if (window.confirm(`確定刪除 ${table.label}？`)) void run({ operation: "DELETE_TABLE", tableId: table.id }, "桌位已刪除。"); }} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-red-300 text-red-700" title={`刪除 ${table.label}`}><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                {qrUrl ? <div className="flex flex-col items-center gap-2 border-l-0 border-stone-200 lg:border-l lg:pl-4"><QRCodeSVG value={qrUrl} size={120} level="M" /><button type="button" onClick={() => void navigator.clipboard.writeText(qrUrl)} className="inline-flex items-center gap-1 text-xs font-semibold text-teal-800"><Copy className="h-3.5 w-3.5" />複製網址</button><span className="text-xs text-stone-500">QR v{table.qrCode?.tokenVersion}</span></div> : null}
              </div>;
            })}
            {activeFloorTables.length === 0 ? <p className="py-6 text-sm text-stone-500">{activeFloor?.name ?? "此樓層"}尚未建立內用桌位。</p> : null}
          </div>
        </div>
      </details>

      <details
        id="payment-options"
        open={openSections.has("payments")}
        onToggle={(event) => handleSectionToggle("payments", event)}
        data-module-section="payments"
        className="border-b border-stone-200 scroll-mt-24 [&[open]>summary_.section-chevron]:rotate-180"
      >
        <CollapsibleSectionSummary icon={WalletCards} title="付款方式" level={3} />
        <div className="pb-6">
          <div className="grid gap-2 border-b border-stone-200 pb-4 sm:grid-cols-[110px_1fr_150px_80px_auto]">
            <TextInput label="代碼" value={newPayment.code} fieldKey={fieldKey("new-payment", "code")} error={errorFor("new-payment", "code")} maxLength={30} pattern="[A-Za-z0-9_-]+" onChange={(code) => setNewPayment({ ...newPayment, code: code.toUpperCase() })} />
            <TextInput label="名稱" value={newPayment.name} fieldKey={fieldKey("new-payment", "name")} error={errorFor("new-payment", "name")} onChange={(name) => setNewPayment({ ...newPayment, name })} />
            <PaymentKind value={newPayment.kind} fieldKey={fieldKey("new-payment", "kind")} error={errorFor("new-payment", "kind")} onChange={(kind) => setNewPayment({ ...newPayment, kind })} />
            <NumberInput label="排序" value={newPayment.sortOrder} fieldKey={fieldKey("new-payment", "sortOrder")} error={errorFor("new-payment", "sortOrder")} onChange={(sortOrder) => setNewPayment({ ...newPayment, sortOrder })} />
            <button type="button" disabled={busy} onClick={async () => {
              if (await run({ operation: "CREATE_PAYMENT_OPTION", ...newPayment }, "付款方式已新增。")) setNewPayment({ code: "", name: "", kind: "CUSTOM", isEnabled: true, sortOrder: state.paymentOptions.length + 2 });
            }} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold disabled:opacity-40"><Plus className="h-4 w-4" />新增</button>
          </div>
          <div className="divide-y divide-stone-200">{state.paymentOptions.map((option) => {
            const scope = `payment-${option.id}`;
            return <div key={option.id} className="grid gap-2 py-4 sm:grid-cols-[110px_1fr_150px_80px_auto] sm:items-end"><TextInput label="代碼" value={option.code} fieldKey={fieldKey(scope, "code")} error={errorFor(scope, "code")} maxLength={30} pattern="[A-Za-z0-9_-]+" onChange={(code) => updatePayment(option.id, { code: code.toUpperCase() })} /><TextInput label="名稱" value={option.name} fieldKey={fieldKey(scope, "name")} error={errorFor(scope, "name")} onChange={(name) => updatePayment(option.id, { name })} /><PaymentKind value={option.kind} fieldKey={fieldKey(scope, "kind")} error={errorFor(scope, "kind")} onChange={(kind) => updatePayment(option.id, { kind })} /><NumberInput label="排序" value={option.sortOrder} fieldKey={fieldKey(scope, "sortOrder")} error={errorFor(scope, "sortOrder")} onChange={(sortOrder) => updatePayment(option.id, { sortOrder })} /><div className="flex gap-2"><button type="button" role="switch" aria-checked={option.isEnabled} onClick={() => updatePayment(option.id, { isEnabled: !option.isEnabled })} className="h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold">{option.isEnabled ? "已啟用" : "已停用"}</button><button type="button" title={`儲存 ${option.name}`} onClick={() => void run({ operation: "UPDATE_PAYMENT_OPTION", paymentOptionId: option.id, code: option.code, name: option.name, kind: option.kind, isEnabled: option.isEnabled, sortOrder: option.sortOrder }, "付款方式已儲存。")} className="grid h-10 w-10 place-items-center rounded-md bg-stone-900 text-white"><Save className="h-4 w-4" /></button><button type="button" title={`刪除 ${option.name}`} onClick={() => { if (window.confirm(`確定刪除 ${option.name}？歷史付款仍會保留名稱。`)) void run({ operation: "DELETE_PAYMENT_OPTION", paymentOptionId: option.id }, "付款方式已刪除。"); }} className="grid h-10 w-10 place-items-center rounded-md border border-red-300 text-red-700"><Trash2 className="h-4 w-4" /></button></div></div>;
          })}</div>
        </div>
      </details>

      <details
        id="discount-options"
        open={openSections.has("discounts")}
        onToggle={(event) => handleSectionToggle("discounts", event)}
        data-module-section="discounts"
        className="scroll-mt-24 border-b border-stone-200 [&[open]>summary_.section-chevron]:rotate-180"
      >
        <CollapsibleSectionSummary icon={Percent} title="結帳折扣" level={3} />
        <div className="pb-6">
          <div className="grid gap-2 border-b border-stone-200 pb-4 sm:grid-cols-[1fr_130px_80px_auto]"><TextInput label="折扣名稱" value={newDiscount.name} fieldKey={fieldKey("new-discount", "name")} error={errorFor("new-discount", "name")} onChange={(name) => setNewDiscount({ ...newDiscount, name })} /><PercentInput value={newDiscount.rateBps} fieldKey={fieldKey("new-discount", "rateBps")} error={errorFor("new-discount", "rateBps")} onChange={(rateBps) => setNewDiscount({ ...newDiscount, rateBps })} /><NumberInput label="排序" value={newDiscount.sortOrder} fieldKey={fieldKey("new-discount", "sortOrder")} error={errorFor("new-discount", "sortOrder")} onChange={(sortOrder) => setNewDiscount({ ...newDiscount, sortOrder })} /><button type="button" disabled={busy} onClick={async () => { if (await run({ operation: "CREATE_DISCOUNT", ...newDiscount }, "折扣已新增。")) setNewDiscount({ name: "", rateBps: 9000, isEnabled: true, sortOrder: state.discounts.length + 2 }); }} className="mt-6 inline-flex h-10 items-center justify-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Plus className="h-4 w-4" />新增</button></div>
          <div className="divide-y divide-stone-200">{state.discounts.map((discount) => {
            const scope = `discount-${discount.id}`;
            return <div key={discount.id} className="grid gap-2 py-4 sm:grid-cols-[1fr_130px_80px_auto] sm:items-end"><TextInput label="折扣名稱" value={discount.name} fieldKey={fieldKey(scope, "name")} error={errorFor(scope, "name")} onChange={(name) => updateDiscount(discount.id, { name })} /><PercentInput value={discount.rateBps} fieldKey={fieldKey(scope, "rateBps")} error={errorFor(scope, "rateBps")} onChange={(rateBps) => updateDiscount(discount.id, { rateBps })} /><NumberInput label="排序" value={discount.sortOrder} fieldKey={fieldKey(scope, "sortOrder")} error={errorFor(scope, "sortOrder")} onChange={(sortOrder) => updateDiscount(discount.id, { sortOrder })} /><div className="flex gap-2"><button type="button" role="switch" aria-checked={discount.isEnabled} onClick={() => updateDiscount(discount.id, { isEnabled: !discount.isEnabled })} className="h-10 rounded-md border border-stone-300 px-3 text-xs font-semibold">{discount.isEnabled ? "已啟用" : "已停用"}</button><button type="button" title={`儲存 ${discount.name}`} onClick={() => void run({ operation: "UPDATE_DISCOUNT", discountId: discount.id, name: discount.name, rateBps: discount.rateBps, isEnabled: discount.isEnabled, sortOrder: discount.sortOrder }, "折扣已儲存。")} className="grid h-10 w-10 place-items-center rounded-md bg-stone-900 text-white"><Save className="h-4 w-4" /></button><button type="button" title={`刪除 ${discount.name}`} onClick={() => { if (window.confirm(`確定刪除 ${discount.name}？`)) void run({ operation: "DELETE_DISCOUNT", discountId: discount.id }, "折扣已刪除。"); }} className="grid h-10 w-10 place-items-center rounded-md border border-red-300 text-red-700"><Trash2 className="h-4 w-4" /></button></div></div>;
          })}</div>
        </div>
      </details>
      {message ? <p role={messageKind === "error" ? "alert" : "status"} className={`mt-4 text-sm font-medium ${messageKind === "error" ? "text-red-700" : "text-stone-700"}`}>{message}</p> : null}
        </div>
      </details>
    </section>
  );
}

function ModuleSwitch({ label, icon, checked, disabled = false, onChange }: { label: string; icon?: React.ReactNode; checked: boolean; disabled?: boolean; onChange: (value: boolean) => void }) {
  return <button type="button" role="switch" aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`flex min-h-12 items-center gap-3 rounded-md border px-3 text-left text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-70 ${checked ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-600"}`}>{icon ? <span aria-hidden="true" className="grid h-5 w-5 shrink-0 place-items-center">{icon}</span> : null}<span>{label}</span><span className="ml-auto text-xs">{checked ? "開啟" : "關閉"}</span></button>;
}

function TextInput({ label, value, fieldKey: controlFieldKey, error, maxLength = 50, pattern, onChange }: {
  label: string;
  value: string;
  fieldKey?: string;
  error?: string;
  maxLength?: number;
  pattern?: string;
  onChange: (value: string) => void;
}) {
  return <label className="text-xs font-medium text-stone-600">{label}<input {...validationAttributes(controlFieldKey, error)} type="text" value={value} onChange={(event) => onChange(event.target.value)} maxLength={maxLength} pattern={pattern} className={inputClass(error)} /><FieldError fieldKey={controlFieldKey} error={error} /></label>;
}

function NumberInput({ label, value, fieldKey: controlFieldKey, error, min = 0, max = 10000, onChange }: {
  label: string;
  value: number;
  fieldKey?: string;
  error?: string;
  min?: number;
  max?: number;
  onChange: (value: number) => void;
}) {
  return <label className="text-xs font-medium text-stone-600">{label}<input {...validationAttributes(controlFieldKey, error)} type="number" min={min} max={max} value={value} onChange={(event) => onChange(Number(event.target.value))} className={inputClass(error)} /><FieldError fieldKey={controlFieldKey} error={error} /></label>;
}

function PercentInput({ value, fieldKey: controlFieldKey, error, onChange }: { value: number; fieldKey?: string; error?: string; onChange: (value: number) => void }) {
  return <label className="text-xs font-medium text-stone-600">付款比例（%）<input {...validationAttributes(controlFieldKey, error)} type="number" min={1} max={100} step={1} value={value / 100} onChange={(event) => onChange(Math.round(Number(event.target.value) * 100))} className={inputClass(error)} /><FieldError fieldKey={controlFieldKey} error={error} /></label>;
}

function PaymentKind({ value, fieldKey: controlFieldKey, error, onChange }: { value: PaymentDraft["kind"]; fieldKey?: string; error?: string; onChange: (value: PaymentDraft["kind"]) => void }) {
  return <label className="text-xs font-medium text-stone-600">類型<select {...validationAttributes(controlFieldKey, error)} value={value} onChange={(event) => onChange(event.target.value as PaymentDraft["kind"])} className={`${inputClass(error)} bg-white`}><option value="CASH">現金</option><option value="LINE_PAY">LINE Pay</option><option value="JKO_PAY">街口支付</option><option value="CUSTOM">自訂</option></select><FieldError fieldKey={controlFieldKey} error={error} /></label>;
}

function FloorSelect({ floors, value, fieldKey: controlFieldKey, error, onChange }: {
  floors: ReturnType<typeof getDiningFloorTabs>;
  value: string | null;
  fieldKey?: string;
  error?: string;
  onChange: (value: string | null) => void;
}) {
  return <label className="text-xs font-medium text-stone-600">樓層<select {...validationAttributes(controlFieldKey, error)} value={value ?? ""} onChange={(event) => onChange(event.target.value || null)} className={`${inputClass(error)} bg-white`}>{floors.map((floor) => <option key={floor.key} value={floor.id ?? ""}>{floor.name}{floor.isVirtual ? "（尚未建立）" : ""}</option>)}</select><FieldError fieldKey={controlFieldKey} error={error} /></label>;
}

function TableShapeSelect({ value, fieldKey: controlFieldKey, error, onChange }: {
  value: DiningTableShape;
  fieldKey?: string;
  error?: string;
  onChange: (value: DiningTableShape) => void;
}) {
  return <label className="text-xs font-medium text-stone-600">桌型<select {...validationAttributes(controlFieldKey, error)} value={value} onChange={(event) => onChange(event.target.value as DiningTableShape)} className={`${inputClass(error)} bg-white`}>{DINING_TABLE_SHAPES.map((shape) => <option key={shape} value={shape}>{diningTableShapeLabels[shape]}</option>)}</select><FieldError fieldKey={controlFieldKey} error={error} /></label>;
}

function TableRotationSelect({ value, fieldKey: controlFieldKey, error, onChange }: {
  value: number;
  fieldKey?: string;
  error?: string;
  onChange: (value: number) => void;
}) {
  return <label className="text-xs font-medium text-stone-600">旋轉角度<select {...validationAttributes(controlFieldKey, error)} value={value} onChange={(event) => onChange(Number(event.target.value))} className={`${inputClass(error)} bg-white`}>{Array.from({ length: 24 }, (_, index) => index * 15).map((rotation) => <option key={rotation} value={rotation}>{rotation}°</option>)}</select><FieldError fieldKey={controlFieldKey} error={error} /></label>;
}

function fieldKey(scope: string, field: string) {
  return `${scope}:${field}`;
}

function fieldErrorId(controlFieldKey: string) {
  return `stall-module-${controlFieldKey.replace(/[^a-zA-Z0-9_-]/g, "-")}-error`;
}

function validationAttributes(controlFieldKey?: string, error?: string) {
  return {
    "data-field-key": controlFieldKey,
    "aria-invalid": error ? true : undefined,
    "aria-describedby": controlFieldKey && error ? fieldErrorId(controlFieldKey) : undefined,
  };
}

function inputClass(error?: string) {
  return `mt-1 h-11 w-full rounded-md border px-2 text-sm ${error ? "border-red-500 bg-red-50" : "border-stone-300"}`;
}

function formatPercentage(rateBps: number) {
  return `${Number((rateBps / 100).toFixed(2))}%`;
}

function FieldError({ fieldKey: controlFieldKey, error }: { fieldKey?: string; error?: string }) {
  return controlFieldKey && error
    ? <span id={fieldErrorId(controlFieldKey)} role="alert" className="mt-1 block text-xs font-medium text-red-700">{error}</span>
    : null;
}

function commandFieldScope(command: Record<string, unknown>) {
  switch (command.operation) {
    case "CREATE_FLOOR": return "new-floor";
    case "UPDATE_FLOOR": return `floor-${String(command.floorId)}`;
    case "CREATE_TABLE": return "new-table";
    case "UPDATE_TABLE": return `table-${String(command.tableId)}`;
    case "UPDATE_TABLE_LAYOUT": return "table-layout";
    case "UPDATE_LOCALES": return "locales";
    case "CREATE_PAYMENT_OPTION": return "new-payment";
    case "UPDATE_PAYMENT_OPTION": return `payment-${String(command.paymentOptionId)}`;
    case "CREATE_DISCOUNT": return "new-discount";
    case "UPDATE_DISCOUNT": return `discount-${String(command.discountId)}`;
    default: return "modules";
  }
}

export function mergeModuleStateAfterCommand(
  draftState: ModuleState,
  savedState: ModuleState,
  serverState: ModuleState,
  command: Record<string, unknown>,
): ModuleState {
  const merged: ModuleState = {
    settings: mergeDirtyRecord(draftState.settings, savedState.settings, serverState.settings),
    floors: mergeDirtyEntities(draftState.floors, savedState.floors, serverState.floors),
    tables: mergeDirtyEntities(draftState.tables, savedState.tables, serverState.tables),
    paymentOptions: mergeDirtyEntities(
      draftState.paymentOptions,
      savedState.paymentOptions,
      serverState.paymentOptions,
    ),
    discounts: mergeDirtyEntities(draftState.discounts, savedState.discounts, serverState.discounts),
  };

  switch (command.operation) {
    case "UPDATE_MODULES":
      merged.settings = {
        ...serverState.settings,
        enabledLocales: merged.settings.enabledLocales,
      };
      break;
    case "UPDATE_LOCALES":
      merged.settings.enabledLocales = serverState.settings.enabledLocales;
      break;
    case "UPDATE_FLOOR":
      merged.floors = replaceServerEntity(merged.floors, serverState.floors, String(command.floorId));
      break;
    case "UPDATE_TABLE":
      merged.tables = replaceServerEntity(merged.tables, serverState.tables, String(command.tableId));
      break;
    case "UPDATE_TABLE_LAYOUT": {
      const submittedTableIds = new Set(
        Array.isArray(command.tables)
          ? command.tables.flatMap((table) => (
              table && typeof table === "object" && "tableId" in table
                ? [String(table.tableId)]
                : []
            ))
          : [],
      );
      const serverTables = new Map(serverState.tables.map((table) => [table.id, table]));
      merged.tables = merged.tables.map((table) => {
        const serverTable = serverTables.get(table.id);
        return submittedTableIds.has(table.id) && serverTable
          ? { ...table, layoutX: serverTable.layoutX, layoutY: serverTable.layoutY }
          : table;
      });
      break;
    }
    case "ROTATE_TABLE_QR": {
      const tableId = String(command.tableId);
      const serverTable = serverState.tables.find((table) => table.id === tableId);
      if (serverTable) {
        merged.tables = merged.tables.map((table) => (
          table.id === tableId ? { ...table, qrCode: serverTable.qrCode } : table
        ));
      }
      break;
    }
    case "UPDATE_PAYMENT_OPTION":
      merged.paymentOptions = replaceServerEntity(
        merged.paymentOptions,
        serverState.paymentOptions,
        String(command.paymentOptionId),
      );
      break;
    case "UPDATE_DISCOUNT":
      merged.discounts = replaceServerEntity(
        merged.discounts,
        serverState.discounts,
        String(command.discountId),
      );
      break;
  }

  const enabledDiscountIds = new Set(
    serverState.discounts.filter((discount) => discount.isEnabled).map((discount) => discount.id),
  );
  merged.settings.lotteryDiscountChances = merged.settings.lotteryDiscountChances.filter(
    (chance) => enabledDiscountIds.has(chance.discountOptionId),
  );
  const firstLotteryDiscount = merged.settings.lotteryDiscountChances[0] ?? null;
  merged.settings.lotteryDiscountOptionId = firstLotteryDiscount?.discountOptionId ?? null;
  merged.settings.lotteryDiscountWinRateBps = firstLotteryDiscount?.winRateBps ?? 0;

  return merged;
}

function mergeDirtyRecord<T extends object>(draft: T, saved: T, server: T): T {
  const merged = { ...server } as T;
  for (const key of Object.keys(server) as Array<keyof T>) {
    if (!sameValue(draft[key], saved[key])) merged[key] = draft[key];
  }
  return merged;
}

function mergeDirtyEntities<T extends { id: string }>(draft: T[], saved: T[], server: T[]): T[] {
  const draftById = new Map(draft.map((entity) => [entity.id, entity]));
  const savedById = new Map(saved.map((entity) => [entity.id, entity]));
  return server.map((entity) => {
    const draftEntity = draftById.get(entity.id);
    const savedEntity = savedById.get(entity.id);
    return draftEntity && savedEntity
      ? mergeDirtyRecord(draftEntity, savedEntity, entity)
      : entity;
  });
}

function replaceServerEntity<T extends { id: string }>(merged: T[], server: T[], entityId: string): T[] {
  const serverEntity = server.find((entity) => entity.id === entityId);
  return serverEntity
    ? merged.map((entity) => entity.id === entityId ? serverEntity : entity)
    : merged;
}

function sameValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function omitScopeErrors(current: Record<string, string>, scope: string) {
  return Object.fromEntries(Object.entries(current).filter(([key]) => !key.startsWith(`${scope}:`)));
}

function parseFieldErrors(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string] => (
    typeof entry[1] === "string" && Boolean(entry[1].trim())
  )));
}

function focusFirstInvalidField(container: HTMLElement | null, scope: string, fieldErrors: Record<string, string>) {
  const firstField = Object.keys(fieldErrors)[0];
  if (!firstField) return;
  requestAnimationFrame(() => {
    const control = container?.querySelector<HTMLElement>(`[data-field-key="${CSS.escape(fieldKey(scope, firstField))}"]`);
    control?.focus();
  });
}
