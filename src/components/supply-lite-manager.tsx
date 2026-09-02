"use client";

import { type FormEvent, type MouseEvent, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Building2, CheckCircle2, ChefHat, ChevronRight, ClipboardList, LoaderCircle, MapPin, PackagePlus, Plus, Sparkles, Trash2, TrendingUp, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors } from "@/lib/form-field-errors";
import type { SupplyItemType } from "@/lib/supply-item-code";
import type { getSupplyDashboard } from "@/server/supply-lite/supply-service";

type SupplyDashboard = Awaited<ReturnType<typeof getSupplyDashboard>>;
type SupplyAction = "ingredient" | "supplier" | "location" | "movement" | "recipe" | "purchase";
type EditableSupplyAction = Extract<SupplyAction, "ingredient" | "supplier" | "location" | "recipe">;
type EditTarget = { action: EditableSupplyAction; id: string };
type DeleteTarget = EditTarget & { name: string };

const supplyActionCopy: Record<SupplyAction, { title: string; description: string }> = {
  ingredient: { title: "新增原料與物品", description: "建立食材、包材、耗材或可重複使用器具。" },
  supplier: { title: "新增進貨廠商", description: "建立廠商聯絡方式、付款與到貨天數。" },
  location: { title: "新增庫位", description: "建立中央倉、攤位庫位或一般倉儲。" },
  movement: { title: "登記庫存異動", description: "記錄盤點、耗損、調撥與手動庫存變化。" },
  recipe: { title: "設定商品配方", description: "設定每份商品使用的食材與一次性包材。" },
  purchase: { title: "進貨入庫", description: "一次完成進貨單、批號、效期與庫存入帳。" },
};

const editActionTitles: Record<EditableSupplyAction, string> = {
  ingredient: "修改原料與物品",
  supplier: "修改進貨廠商",
  location: "修改庫位",
  recipe: "修改商品配方",
};

const locationTypeLabels: Record<string, string> = {
  CENTRAL: "中央倉",
  STALL: "攤位庫位",
  STORAGE: "一般倉儲",
  IN_TRANSIT: "運送中",
};

const movementLabels: Record<string, string> = {
  RECEIPT: "進貨",
  ADJUSTMENT: "盤點調整",
  WASTE: "報廢／耗損",
  TRANSFER_IN: "調撥入庫",
  TRANSFER_OUT: "調撥出庫",
  SALE_CONSUMPTION: "銷售耗用",
};
const itemTypeLabels: Record<string, string> = {
  INGREDIENT: "食材",
  PACKAGING: "包材",
  CONSUMABLE: "耗材",
  REUSABLE_EQUIPMENT: "可重複使用餐具／設備",
};

function units(micros: string) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(Number(micros) / 1_000_000);
}

function toMicros(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000_000) : Number.NaN;
}

function microsInput(micros: string) {
  return String(Number(micros) / 1_000_000);
}

export function SupplyLiteManager({
  organizationId,
  initialDashboard,
}: {
  organizationId: string;
  initialDashboard: SupplyDashboard;
}) {
  const [dashboard, setDashboard] = useState(initialDashboard);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [purchaseLines, setPurchaseLines] = useState(["line-1"]);
  const [activeAction, setActiveAction] = useState<SupplyAction | null>(null);
  const [editTarget, setEditTarget] = useState<EditTarget | null>(null);
  const [recordTarget, setRecordTarget] = useState<DeleteTarget | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const ingredientNames = useMemo(
    () => new Map(dashboard.ingredients.map((item) => [item.id, item.name])),
    [dashboard.ingredients],
  );
  const locationNames = useMemo(
    () => new Map(dashboard.locations.map((item) => [item.id, item.name])),
    [dashboard.locations],
  );
  const productNames = useMemo(
    () => new Map(dashboard.products.map((item) => [item.id, item.name])),
    [dashboard.products],
  );
  const stallNames = useMemo(
    () => new Map(dashboard.stalls.map((item) => [item.id, item.name])),
    [dashboard.stalls],
  );
  const editingIngredient = editTarget?.action === "ingredient"
    ? dashboard.ingredients.find((item) => item.id === editTarget.id)
    : undefined;
  const editingSupplier = editTarget?.action === "supplier"
    ? dashboard.suppliers.find((item) => item.id === editTarget.id)
    : undefined;
  const editingLocation = editTarget?.action === "location"
    ? dashboard.locations.find((item) => item.id === editTarget.id)
    : undefined;
  const editingRecipe = editTarget?.action === "recipe"
    ? dashboard.recipeComponents.find((item) => item.id === editTarget.id)
    : undefined;
  const recipeEligibleIngredients = dashboard.ingredients.filter(
    (item) => item.itemType === "INGREDIENT" || item.itemType === "PACKAGING",
  );

  useEffect(() => {
    if (!activeAction && !recordTarget && !deleteTarget) return;
    const previousOverflow = document.body.style.overflow;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        if (deleteTarget) setDeleteTarget(null);
        else if (recordTarget) setRecordTarget(null);
        else {
          setActiveAction(null);
          setEditTarget(null);
        }
      }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeAction, busy, deleteTarget, recordTarget]);

  function openAction(action: SupplyAction) {
    setMessage("");
    setFieldErrors({});
    setEditTarget(null);
    setRecordTarget(null);
    setDeleteTarget(null);
    setActiveAction(action);
  }

  function openRecordDialog(action: EditableSupplyAction, id: string, name: string) {
    setMessage("");
    setFieldErrors({});
    setActiveAction(null);
    setEditTarget(null);
    setDeleteTarget(null);
    setRecordTarget({ action, id, name });
  }

  function openEditAction(action: EditableSupplyAction, id: string) {
    setMessage("");
    setFieldErrors({});
    setRecordTarget(null);
    setDeleteTarget(null);
    setEditTarget({ action, id });
    setActiveAction(action);
  }

  function openDeleteDialog(action: EditableSupplyAction, id: string, name: string) {
    setMessage("");
    setFieldErrors({});
    setActiveAction(null);
    setEditTarget(null);
    setRecordTarget(null);
    setDeleteTarget({ action, id, name });
  }

  function closeAction() {
    if (busy) return;
    setFieldErrors({});
    setActiveAction(null);
    setEditTarget(null);
  }

  async function sendCommand(command: Record<string, unknown>, successMessage: string) {
    if (busy) return false;
    setBusy(true);
    setMessage("");
    setFieldErrors({});
    try {
      const response = await fetch(`/api/merchant/organizations/${organizationId}/supply`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify(command),
      });
      const payload = await response.json() as (SupplyDashboard & { error?: string; fieldErrors?: unknown });
      if (!response.ok || payload.error) {
        setMessage(payload.error ?? "目前無法更新原料與庫存資料。" );
        setFieldErrors(parseFieldErrors(payload.fieldErrors));
        return false;
      }
      setDashboard(payload);
      setMessage(successMessage);
      return true;
    } catch {
      setMessage("網路連線中斷，請稍後再試。");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function createIngredient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await sendCommand({
      operation: editingIngredient ? "UPDATE_INGREDIENT" : "CREATE_INGREDIENT",
      ...(editingIngredient ? { ingredientId: editingIngredient.id } : {}),
      code: data.get("code"),
      name: data.get("name"),
      baseUom: data.get("baseUom"),
      itemType: data.get("itemType"),
      trackExpiry: data.get("trackExpiry") === "on",
      defaultShelfLifeDays: data.get("defaultShelfLifeDays") ? Number(data.get("defaultShelfLifeDays")) : null,
      preferredSupplierId: data.get("preferredSupplierId") || null,
      lowStockThresholdMicros: toMicros(data.get("threshold")),
    }, editingIngredient ? "品項資料已修改。" : "品項已建立。");
    if (ok) {
      form.reset();
      setActiveAction(null);
      setEditTarget(null);
    }
  }

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await sendCommand({
      operation: editingSupplier ? "UPDATE_SUPPLIER" : "CREATE_SUPPLIER",
      ...(editingSupplier ? { supplierId: editingSupplier.id } : {}),
      code: data.get("code"),
      name: data.get("name"),
      contactName: data.get("contactName") || null,
      phone: data.get("phone") || null,
      email: data.get("email") || null,
      paymentTermsDays: Number(data.get("paymentTermsDays") || 0),
      leadTimeDays: Number(data.get("leadTimeDays") || 0),
    }, editingSupplier ? "廠商資料已修改。" : "廠商資料已建立。");
    if (ok) {
      form.reset();
      setActiveAction(null);
      setEditTarget(null);
    }
  }

  async function receivePurchase(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await sendCommand({
      operation: "RECEIVE_PURCHASE",
      supplierId: data.get("supplierId"),
      stallId: data.get("stallId") || null,
      documentNumber: data.get("documentNumber"),
      orderedOn: data.get("orderedOn"),
      expectedOn: data.get("expectedOn") || null,
      taxAmount: Math.round(Number(data.get("taxAmount") || 0)),
      freightAmount: Math.round(Number(data.get("freightAmount") || 0)),
      note: data.get("note") || null,
      lines: purchaseLines.map((lineId) => ({
        ingredientId: data.get(`ingredientId:${lineId}`),
        locationId: data.get(`locationId:${lineId}`),
        quantityMicros: toMicros(data.get(`quantity:${lineId}`)),
        unitCostMicros: toMicros(data.get(`unitCost:${lineId}`)),
        lotNumber: data.get(`lotNumber:${lineId}`) || null,
        manufacturedOn: data.get(`manufacturedOn:${lineId}`) || null,
        expiresOn: data.get(`expiresOn:${lineId}`) || null,
      })),
    }, "進貨單、批號與庫存流水已一次完成入帳。");
    if (ok) {
      form.reset();
      setPurchaseLines(["line-1"]);
      setActiveAction(null);
    }
  }

  async function createLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const locationType = String(data.get("locationType"));
    const ok = await sendCommand({
      operation: editingLocation ? "UPDATE_LOCATION" : "CREATE_LOCATION",
      ...(editingLocation ? { locationId: editingLocation.id } : {}),
      code: data.get("code"),
      name: data.get("name"),
      locationType,
      stallId: locationType === "STALL" ? data.get("stallId") || null : null,
    }, editingLocation ? "庫位資料已修改。" : "庫位已建立。");
    if (ok) {
      form.reset();
      setActiveAction(null);
      setEditTarget(null);
    }
  }

  async function postMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const movementType = String(data.get("movementType"));
    const absoluteMicros = Math.abs(toMicros(data.get("quantity")));
    const negative = ["WASTE", "TRANSFER_OUT", "SALE_CONSUMPTION"].includes(movementType);
    const ok = await sendCommand({
      operation: "POST_MOVEMENT",
      ingredientId: data.get("ingredientId"),
      locationId: data.get("locationId"),
      movementType,
      quantityDeltaMicros: negative ? -absoluteMicros : absoluteMicros,
      unitCostMicros: data.get("unitCost") ? toMicros(data.get("unitCost")) : null,
      sourceType: "MANUAL_MERCHANT",
      sourceId: crypto.randomUUID(),
      idempotencyKey: `supply:merchant:${crypto.randomUUID()}`,
      reason: data.get("reason"),
    }, "庫存流水已寫入；同一筆操作不會重複計算。");
    if (ok) {
      form.reset();
      setActiveAction(null);
    }
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await sendCommand({
      operation: "UPSERT_RECIPE_COMPONENT",
      productId: editingRecipe?.productId ?? data.get("productId"),
      ingredientId: editingRecipe?.ingredientId ?? data.get("ingredientId"),
      quantityMicros: toMicros(data.get("quantity")),
      wasteBasisPoints: Math.round(Number(data.get("wastePercent")) * 100),
    }, "商品配方已更新。");
    if (ok) {
      form.reset();
      setActiveAction(null);
      setEditTarget(null);
    }
  }

  async function confirmDelete() {
    if (!deleteTarget) return;
    const commands: Record<EditableSupplyAction, Record<string, unknown>> = {
      ingredient: { operation: "ARCHIVE_INGREDIENT", ingredientId: deleteTarget.id },
      supplier: { operation: "ARCHIVE_SUPPLIER", supplierId: deleteTarget.id },
      location: { operation: "ARCHIVE_LOCATION", locationId: deleteTarget.id },
      recipe: { operation: "REMOVE_RECIPE_COMPONENT", componentId: deleteTarget.id },
    };
    const ok = await sendCommand(
      commands[deleteTarget.action],
      deleteTarget.action === "recipe" ? "配方項目已移除。" : "資料已安全停用，歷史紀錄仍保留。",
    );
    if (ok) setDeleteTarget(null);
  }

  const lowStockCount = dashboard.ingredients.filter((item) => item.lowStock).length;
  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm leading-6 text-amber-950">
        <div className="flex items-start gap-3">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <h2 className="font-semibold">本機安全試用</h2>
            <p className="mt-1">進貨單會同步建立批號、效期、移動平均成本與庫存流水；目前仍不會自動依訂單扣料，避免未完成盤點與配方前誤扣庫存。</p>
          </div>
        </div>
      </section>

      {dashboard.lotCoverageGapCount > 0 ? (
        <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          有 {dashboard.lotCoverageGapCount} 個效期品庫位的帳面庫存與批號剩餘量不一致，請先盤點修正再據此判斷新鮮度。
        </p>
      ) : null}

      <section aria-label="原料與庫存摘要" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {[
          ["食材／包材／耗材／器具", dashboard.ingredients.length],
          ["廠商", dashboard.suppliers.length],
          ["庫位", dashboard.locations.length],
          ["商品配方", dashboard.recipeComponents.length],
          ["低庫存", lowStockCount],
          ["批號差異", dashboard.lotCoverageGapCount],
          ["庫存估值", `$${dashboard.inventoryValueAmount.toLocaleString("zh-TW")}`],
        ].map(([label, value]) => (
          <article key={label} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-600">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-stone-950">{value}</p>
          </article>
        ))}
      </section>

      {message ? <p role="status" className={`rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}

      <section aria-labelledby="supply-actions-title" className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm sm:p-5">
        <div>
          <h2 id="supply-actions-title" className="text-xl font-semibold text-stone-950">新增與庫存操作</h2>
          <p className="mt-1 text-sm leading-6 text-stone-600">點選大型按鈕後，再於獨立視窗完成資料輸入。</p>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          <SupplyActionCard testId="open-supply-ingredient" title="新增原料與物品" description="食材、包材、耗材與器具" icon={<PackagePlus className="h-7 w-7" />} onClick={() => openAction("ingredient")} />
          <SupplyActionCard testId="open-supply-supplier" title="新增進貨廠商" description="聯絡方式與交貨條件" icon={<Building2 className="h-7 w-7" />} onClick={() => openAction("supplier")} />
          <SupplyActionCard testId="open-supply-location" title="新增庫位" description="中央倉、攤位或一般倉儲" icon={<MapPin className="h-7 w-7" />} onClick={() => openAction("location")} />
          <SupplyActionCard testId="open-supply-movement" title="登記庫存異動" description="盤點、耗損、調撥與手動調整" icon={<Boxes className="h-7 w-7" />} onClick={() => openAction("movement")} />
          <SupplyActionCard testId="open-supply-recipe" title="設定商品配方" description="食材與一次性包材用量" icon={<ChefHat className="h-7 w-7" />} onClick={() => openAction("recipe")} />
          <SupplyActionCard testId="open-supply-purchase" title="進貨入庫" description="進貨單、批號與效期" icon={<ClipboardList className="h-7 w-7" />} onClick={() => openAction("purchase")} />
        </div>
      </section>

      {activeAction ? (
        <SupplyActionDialog title={editTarget ? editActionTitles[editTarget.action] : supplyActionCopy[activeAction].title} description={editTarget ? "修改後會立即套用；已有歷史紀錄的關鍵欄位會受到保護。" : supplyActionCopy[activeAction].description} busy={busy} onClose={closeAction}>
          {message ? <p role="status" className={`mb-4 rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}
          <div className="grid gap-4">
        <SupplyForm title={editingIngredient ? "修改食材／包材／耗材／器具" : "新增食材／包材／耗材／器具"} icon={<PackagePlus className="h-5 w-5" />} onSubmit={createIngredient} busy={busy} hidden={activeAction !== "ingredient"}>
          <SupplyItemIdentityFields
            key={editingIngredient?.id ?? "new-ingredient"}
            initialCode={editingIngredient?.code}
            initialName={editingIngredient?.name}
            initialItemType={(editingIngredient?.itemType ?? "INGREDIENT") as SupplyItemType}
            existingCodes={dashboard.ingredients.map((ingredient) => ingredient.code)}
            codeError={fieldErrors.code}
            nameError={fieldErrors.name}
          />
          <SelectField label="基本單位" name="baseUom" defaultValue={editingIngredient?.baseUom} error={fieldErrors.baseUom} options={[["G", "公克"], ["KG", "公斤"], ["ML", "毫升"], ["L", "公升"], ["EA", "個／份"]]} />
          <SelectField label="品項類型" name="itemType" defaultValue={editingIngredient?.itemType} error={fieldErrors.itemType} options={Object.entries(itemTypeLabels)} />
          <SelectField label="主要廠商（選填）" name="preferredSupplierId" defaultValue={editingIngredient?.preferredSupplierId ?? ""} required={false} error={fieldErrors.preferredSupplierId} options={[["", "尚未指定"], ...dashboard.suppliers.map((supplier) => [supplier.id, supplier.name] as const)]} />
          <Field label="預設保存天數（選填）" name="defaultShelfLifeDays" type="number" min="1" max="3650" defaultValue={editingIngredient?.defaultShelfLifeDays ?? undefined} required={false} error={fieldErrors.defaultShelfLifeDays} />
          <LargeToggleField key={editingIngredient?.id ?? "new-ingredient"} name="trackExpiry" label="追蹤批號與有效日期" description="需要管理批號、製造日或有效日期時開啟。" defaultChecked={editingIngredient?.trackExpiry ?? false} />
          <Field label="低庫存門檻（基本單位）" name="threshold" type="number" min="0" step="0.001" defaultValue={editingIngredient ? microsInput(editingIngredient.lowStockThresholdMicros) : "0"} error={fieldErrors.lowStockThresholdMicros} />
        </SupplyForm>

        <SupplyForm title={editingSupplier ? "修改進貨廠商" : "新增進貨廠商"} icon={<Building2 className="h-5 w-5" />} onSubmit={createSupplier} busy={busy} hidden={activeAction !== "supplier"}>
          <Field label="廠商代碼" name="code" placeholder="SUPPLIER_A" defaultValue={editingSupplier?.code} error={fieldErrors.code} />
          <Field label="廠商名稱" name="name" placeholder="安心食材行" defaultValue={editingSupplier?.name} error={fieldErrors.name} />
          <Field label="聯絡人（選填）" name="contactName" defaultValue={editingSupplier?.contactName ?? undefined} required={false} />
          <Field label="電話（選填）" name="phone" type="tel" defaultValue={editingSupplier?.phone ?? undefined} required={false} />
          <Field label="Email（選填）" name="email" type="email" defaultValue={editingSupplier?.email ?? undefined} required={false} />
          <Field label="付款天數" name="paymentTermsDays" type="number" min="0" max="365" defaultValue={editingSupplier?.paymentTermsDays ?? 0} />
          <Field label="前置天數" name="leadTimeDays" type="number" min="0" max="365" defaultValue={editingSupplier?.leadTimeDays ?? 0} />
        </SupplyForm>

        <SupplyForm title={editingLocation ? "修改庫位" : "新增庫位"} icon={<MapPin className="h-5 w-5" />} onSubmit={createLocation} busy={busy} hidden={activeAction !== "location"}>
          <Field label="庫位代碼" name="code" placeholder="CENTRAL_01" defaultValue={editingLocation?.code} error={fieldErrors.code} />
          <Field label="庫位名稱" name="name" placeholder="中央冷藏庫" defaultValue={editingLocation?.name} error={fieldErrors.name} />
          <SelectField label="庫位類型" name="locationType" defaultValue={editingLocation?.locationType} error={fieldErrors.locationType} options={Object.entries(locationTypeLabels)} />
          <SelectField label="攤位（僅攤位庫位必填）" name="stallId" defaultValue={editingLocation?.stallId ?? ""} error={fieldErrors.stallId} required={false} options={[["", "不指定"] as const, ...dashboard.stalls.map((stall) => [stall.id, stall.name] as const)]} />
        </SupplyForm>

        <SupplyForm title="庫存異動" icon={<Boxes className="h-5 w-5" />} onSubmit={postMovement} busy={busy} hidden={activeAction !== "movement"}>
          <SelectField label="原料" name="ingredientId" error={fieldErrors.ingredientId} options={dashboard.ingredients.map((item) => [item.id, `${item.name}（${item.baseUom}）`] as const)} />
          <SelectField label="庫位" name="locationId" error={fieldErrors.locationId} options={dashboard.locations.map((item) => [item.id, item.name] as const)} />
          <SelectField label="異動類型" name="movementType" options={Object.entries(movementLabels)} />
          <Field label="數量（輸入正數，系統依類型判斷加減）" name="quantity" type="number" min="0.000001" step="0.001" error={fieldErrors.quantityDeltaMicros} />
          <Field label="單位成本（選填）" name="unitCost" type="number" min="0" step="0.000001" required={false} error={fieldErrors.unitCostMicros} />
          <Field label="異動原因" name="reason" placeholder="例行進貨" error={fieldErrors.reason} />
        </SupplyForm>

        <SupplyForm title={editingRecipe ? "修改商品配方" : "商品配方"} icon={<ChefHat className="h-5 w-5" />} onSubmit={saveRecipe} busy={busy} hidden={activeAction !== "recipe"}>
          {editingRecipe ? <ReadOnlyField label="商品" value={productNames.get(editingRecipe.productId) ?? "未知商品"} /> : <SelectField label="商品" name="productId" error={fieldErrors.productId} options={dashboard.products.map((item) => [item.id, item.name] as const)} />}
          {editingRecipe ? <ReadOnlyField label="食材或一次性包材" value={ingredientNames.get(editingRecipe.ingredientId) ?? "未知品項"} /> : <SelectField label="食材或一次性包材" name="ingredientId" error={fieldErrors.ingredientId} options={recipeEligibleIngredients.map((item) => [item.id, item.name] as const)} />}
          <Field label="每份用量（基本單位）" name="quantity" type="number" min="0.000001" step="0.001" defaultValue={editingRecipe ? microsInput(editingRecipe.quantityMicros) : undefined} error={fieldErrors.quantityMicros} />
          <Field label="耗損率（%）" name="wastePercent" type="number" min="0" max="100" step="0.01" defaultValue={editingRecipe ? editingRecipe.wasteBasisPoints / 100 : 0} error={fieldErrors.wasteBasisPoints} />
          <p className="text-xs leading-5 text-stone-500 sm:col-span-2">可重複使用餐盤、餐具與設備只追蹤庫存，不會依每筆訂單扣入配方成本。</p>
        </SupplyForm>
      </div>

      <form hidden={activeAction !== "purchase"} onSubmit={receivePurchase} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="flex items-center gap-2 text-lg font-semibold"><ClipboardList className="h-5 w-5" />進貨、批號與效期入庫</h2><button type="button" onClick={() => setPurchaseLines((current) => [...current, crypto.randomUUID()])} className="inline-flex min-h-10 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-semibold"><Plus className="h-4 w-4" />新增明細</button></div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField label="廠商" name="supplierId" options={dashboard.suppliers.map((supplier) => [supplier.id, supplier.name] as const)} error={fieldErrors.supplierId} />
          <SelectField label="歸屬攤位（選填）" name="stallId" required={false} options={[["", "組織共用"], ...dashboard.stalls.map((stall) => [stall.id, stall.name] as const)]} />
          <Field label="進貨單號" name="documentNumber" placeholder="PO-20260829-001" error={fieldErrors.documentNumber} />
          <Field label="進貨日" name="orderedOn" type="date" defaultValue={new Date().toISOString().slice(0, 10)} error={fieldErrors.orderedOn} />
          <Field label="預計到貨日（選填）" name="expectedOn" type="date" required={false} error={fieldErrors.expectedOn} />
          <Field label="稅額" name="taxAmount" type="number" min="0" step="1" defaultValue="0" />
          <Field label="運費" name="freightAmount" type="number" min="0" step="1" defaultValue="0" />
          <Field label="備註（選填）" name="note" required={false} />
        </div>
        <div className="mt-4 space-y-3">
          {purchaseLines.map((lineId, index) => <fieldset key={lineId} className="rounded-lg border border-stone-200 p-3"><legend className="px-2 text-sm font-semibold">明細 {index + 1}</legend><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"><SelectField label="品項" name={`ingredientId:${lineId}`} options={dashboard.ingredients.map((item) => [item.id, `${item.name}（${item.baseUom}）`] as const)} /><SelectField label="入庫庫位" name={`locationId:${lineId}`} options={dashboard.locations.map((item) => [item.id, item.name] as const)} /><Field label="數量（基本單位）" name={`quantity:${lineId}`} type="number" min="0.000001" step="0.001" /><Field label="每基本單位成本" name={`unitCost:${lineId}`} type="number" min="0" step="0.000001" /><Field label="批號（效期品必填）" name={`lotNumber:${lineId}`} required={false} /><Field label="製造日（選填）" name={`manufacturedOn:${lineId}`} type="date" required={false} /><Field label="有效日期（選填）" name={`expiresOn:${lineId}`} type="date" required={false} />{purchaseLines.length > 1 ? <button type="button" onClick={() => setPurchaseLines((current) => current.filter((value) => value !== lineId))} className="inline-flex min-h-11 self-end items-center justify-center gap-2 rounded-md border border-red-300 px-3 text-sm font-semibold text-red-700"><Trash2 className="h-4 w-4" />移除明細</button> : null}</div></fieldset>)}
        </div>
        <button type="submit" disabled={busy || !dashboard.suppliers.length || !dashboard.ingredients.length || !dashboard.locations.length} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}確認到貨並入庫</button>
          </form>
        </SupplyActionDialog>
      ) : null}

      {recordTarget ? (
        <SupplyRecordDialog
          target={recordTarget}
          onClose={() => setRecordTarget(null)}
          onEdit={() => openEditAction(recordTarget.action, recordTarget.id)}
          onDelete={() => openDeleteDialog(recordTarget.action, recordTarget.id, recordTarget.name)}
        />
      ) : null}

      {deleteTarget ? (
        <SupplyDeleteDialog
          target={deleteTarget}
          busy={busy}
          message={message}
          onCancel={() => { if (!busy) setDeleteTarget(null); }}
          onConfirm={confirmDelete}
        />
      ) : null}

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><TrendingUp className="h-5 w-5 text-teal-700" />商品配方毛利</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{dashboard.productCosts.map((product) => <article key={product.productId} className={`rounded-lg border p-3 ${product.recipeComplete ? "border-stone-200" : "border-amber-300 bg-amber-50"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{product.productName}</p><p className="text-xs text-stone-500">售價 ${product.sellingPrice.toLocaleString("zh-TW")} · 配方成本 ${product.recipeCostAmount.toLocaleString("zh-TW")}</p></div><strong className={product.grossProfit >= 0 ? "text-teal-700" : "text-red-700"}>{(product.grossMarginBasisPoints / 100).toFixed(1)}%</strong></div><p className="mt-2 text-sm">單份毛利 ${product.grossProfit.toLocaleString("zh-TW")}</p>{!product.recipeComplete ? <p className="mt-2 text-xs font-semibold text-amber-900">尚未建立配方，毛利不可採信。</p> : null}</article>)}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">批號與新鮮度</h2><div className="mt-3 space-y-2">{dashboard.inventoryLots.map((lot) => { const days = lot.expiresOn ? Math.ceil((Date.parse(`${lot.expiresOn}T00:00:00Z`) - Date.parse(`${dashboard.asOfDate}T00:00:00Z`)) / 86_400_000) : null; return <div key={lot.id} className={`rounded-lg border p-3 text-sm ${days !== null && days < 0 ? "border-red-300 bg-red-50" : days !== null && days <= 7 ? "border-amber-300 bg-amber-50" : "border-stone-200"}`}><div className="flex justify-between gap-2"><strong>{ingredientNames.get(lot.ingredientId) ?? "未知品項"} · {lot.lotNumber}</strong><span>{units(lot.remainingQuantityMicros)}</span></div><p className="mt-1 text-stone-600">{lot.expiresOn ? `有效日期 ${lot.expiresOn}${days !== null ? `（${days < 0 ? `逾期 ${Math.abs(days)} 天` : `剩 ${days} 天`}）` : ""}` : "未設定有效日期"}</p></div>; })}{!dashboard.inventoryLots.length ? <p className="text-sm text-stone-600">尚無批號庫存。</p> : null}</div></article>
        <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold">最近進貨單</h2>
          <p className="mt-1 text-xs leading-5 text-stone-500">已入帳紀錄不可直接修改或刪除；若內容有誤，請新增可追溯的庫存調整。</p>
          <div className="mt-3 space-y-2">{dashboard.purchaseOrders.map((order) => <div key={order.id} className="rounded-lg border border-stone-200 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{order.documentNumber}</strong><strong>${order.totalAmount.toLocaleString("zh-TW")}</strong></div><p className="mt-1 text-stone-600">{order.supplierName} · {order.orderedOn} · {order.lineCount} 項</p></div>)}{!dashboard.purchaseOrders.length ? <p className="text-sm text-stone-600">尚無進貨單。</p> : null}</div>
        </article>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">食材、包材、耗材與器具庫存</h2>
        {dashboard.ingredients.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {dashboard.ingredients.map((ingredient) => (
              <button type="button" key={ingredient.id} data-testid={`manage-supply-ingredient-${ingredient.id}`} onClick={() => openRecordDialog("ingredient", ingredient.id, ingredient.name)} className={`group w-full rounded-lg border p-3 text-left transition focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200 ${ingredient.lowStock ? "border-amber-300 bg-amber-50 hover:border-amber-500" : "border-stone-200 hover:border-teal-600 hover:bg-teal-50"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold text-stone-950">{ingredient.name}</p><p className="text-xs text-stone-500">{itemTypeLabels[ingredient.itemType] ?? ingredient.itemType} · {ingredient.code}</p></div>
                  {ingredient.lowStock ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">低庫存</span> : null}
                </div>
                <div className="mt-3 flex items-end justify-between gap-3"><div><p className="text-xl font-semibold">{units(ingredient.totalQuantityMicros)} <span className="text-sm font-medium text-stone-600">{ingredient.baseUom}</span></p><p className="mt-1 text-xs text-stone-500">門檻 {units(ingredient.lowStockThresholdMicros)} {ingredient.baseUom}</p></div><ChevronRight className="h-6 w-6 shrink-0 text-stone-400 group-hover:text-teal-700" aria-hidden="true" /></div>
              </button>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-stone-600">先新增品項與庫位即可開始測試。</p>}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-stone-950">進貨廠商</h2>
          <div className="mt-3 space-y-3">
            {dashboard.suppliers.map((supplier) => (
              <button type="button" key={supplier.id} data-testid={`manage-supply-supplier-${supplier.id}`} onClick={() => openRecordDialog("supplier", supplier.id, supplier.name)} className="group flex min-h-20 w-full items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 text-left transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">
                <span><span className="block font-semibold text-stone-950">{supplier.name}</span><span className="mt-1 block text-xs text-stone-500">{supplier.code} · 付款 {supplier.paymentTermsDays} 天 · 到貨 {supplier.leadTimeDays} 天</span></span>
                <ChevronRight className="h-6 w-6 shrink-0 text-stone-400 group-hover:text-teal-700" aria-hidden="true" />
              </button>
            ))}
            {!dashboard.suppliers.length ? <p className="text-sm text-stone-600">尚無進貨廠商。</p> : null}
          </div>
        </article>

        <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
          <h2 className="text-lg font-semibold text-stone-950">庫位</h2>
          <div className="mt-3 space-y-3">
            {dashboard.locations.map((location) => (
              <button type="button" key={location.id} data-testid={`manage-supply-location-${location.id}`} onClick={() => openRecordDialog("location", location.id, location.name)} className="group flex min-h-20 w-full items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 text-left transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">
                <span><span className="block font-semibold text-stone-950">{location.name}</span><span className="mt-1 block text-xs text-stone-500">{location.code} · {locationTypeLabels[location.locationType] ?? location.locationType}{location.stallId ? ` · ${stallNames.get(location.stallId) ?? "未知攤位"}` : ""}</span></span>
                <ChevronRight className="h-6 w-6 shrink-0 text-stone-400 group-hover:text-teal-700" aria-hidden="true" />
              </button>
            ))}
            {!dashboard.locations.length ? <p className="text-sm text-stone-600">尚無庫位。</p> : null}
          </div>
        </article>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">商品配方項目</h2>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {dashboard.recipeComponents.map((component) => (
            <button type="button" key={component.id} data-testid={`manage-supply-recipe-${component.id}`} onClick={() => openRecordDialog("recipe", component.id, `${productNames.get(component.productId) ?? "商品"}－${ingredientNames.get(component.ingredientId) ?? "品項"}`)} className="group flex min-h-24 w-full items-center justify-between gap-3 rounded-lg border border-stone-200 p-3 text-left transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">
              <span><span className="block font-semibold text-stone-950">{productNames.get(component.productId) ?? "未知商品"}</span><span className="mt-1 block text-sm text-stone-600">{ingredientNames.get(component.ingredientId) ?? "未知品項"} · {units(component.quantityMicros)} · 耗損 {(component.wasteBasisPoints / 100).toFixed(2)}%</span></span>
              <ChevronRight className="h-6 w-6 shrink-0 text-stone-400 group-hover:text-teal-700" aria-hidden="true" />
            </button>
          ))}
          {!dashboard.recipeComponents.length ? <p className="text-sm text-stone-600">尚無商品配方項目。</p> : null}
        </div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">最近庫存流水</h2>
        <p className="mt-1 text-xs leading-5 text-stone-500">已入帳紀錄不可直接修改或刪除；盤點差異請新增一筆調整以保留稽核軌跡。</p>
        <div className="mt-3 space-y-2">
          {dashboard.recentMovements.map((movement) => (
            <article key={movement.id} className="grid gap-1 rounded-lg border border-stone-200 p-3 text-sm sm:grid-cols-[minmax(0,1fr)_auto]">
              <div><p className="font-semibold text-stone-900">{ingredientNames.get(movement.ingredientId) ?? "未知原料"} · {locationNames.get(movement.locationId) ?? "未知庫位"}</p><p className="text-stone-600">{movementLabels[movement.movementType] ?? movement.movementType}：{movement.reason}</p></div>
              <div className="sm:text-right"><p className={`font-semibold ${movement.quantityDeltaMicros.startsWith("-") ? "text-red-700" : "text-teal-700"}`}>{movement.quantityDeltaMicros.startsWith("-") ? "" : "+"}{units(movement.quantityDeltaMicros)}</p><time className="text-xs text-stone-500" dateTime={movement.createdAt}>{new Intl.DateTimeFormat("zh-TW", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Taipei" }).format(new Date(movement.createdAt))}</time></div>
            </article>
          ))}
          {!dashboard.recentMovements.length ? <p className="text-sm text-stone-600">尚無庫存流水。</p> : null}
        </div>
      </section>
    </div>
  );
}

function SupplyItemIdentityFields({
  initialCode,
  initialName,
  initialItemType,
  existingCodes,
  codeError,
  nameError,
}: {
  initialCode?: string;
  initialName?: string;
  initialItemType: SupplyItemType;
  existingCodes: readonly string[];
  codeError?: string;
  nameError?: string;
}) {
  const [name, setName] = useState(initialName ?? "");
  const [code, setCode] = useState(initialCode ?? "");
  const [suggestingCode, setSuggestingCode] = useState(false);
  const [suggestionError, setSuggestionError] = useState("");

  async function suggestCode(event: MouseEvent<HTMLButtonElement>) {
    const itemTypeControl = event.currentTarget.form?.elements.namedItem("itemType") as HTMLSelectElement | null;
    setSuggestingCode(true);
    setSuggestionError("");
    try {
      const { suggestSupplyItemCode } = await import("@/lib/supply-item-code");
      setCode(suggestSupplyItemCode({
        name,
        itemType: (itemTypeControl?.value || initialItemType) as SupplyItemType,
        existingCodes,
        currentCode: initialCode,
      }));
    } catch {
      setSuggestionError("目前無法產生代碼，請稍後再試或自行輸入。");
    } finally {
      setSuggestingCode(false);
    }
  }

  return (
    <>
      <Field label="品項名稱" name="name" placeholder="去骨雞腿" value={name} onChange={(event) => setName(event.target.value)} error={nameError} />
      <div className="grid gap-2">
        <Field label="品項代碼" name="code" placeholder="ING-QU-GU-JI-TUI" value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} error={codeError} />
        <button type="button" data-testid="suggest-supply-item-code" disabled={!name.trim() || suggestingCode} onClick={(event) => void suggestCode(event)} className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-xl border-2 border-teal-700 bg-teal-50 px-4 text-sm font-semibold text-teal-900 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200 disabled:cursor-not-allowed disabled:opacity-50">
          {suggestingCode ? <LoaderCircle className="h-5 w-5 animate-spin" aria-hidden="true" /> : <Sparkles className="h-5 w-5" aria-hidden="true" />}
          {suggestingCode ? "產生中..." : "智慧產生代碼"}
        </button>
        <p className="text-xs leading-5 text-stone-500">依品項名稱與類型建立，可再自行修改；儲存時仍會檢查是否重複。</p>
        {suggestionError ? <p role="alert" className="text-sm font-semibold text-red-700">{suggestionError}</p> : null}
      </div>
    </>
  );
}

function SupplyRecordDialog({ target, onClose, onEdit, onDelete }: { target: DeleteTarget; onClose: () => void; onEdit: () => void; onDelete: () => void }) {
  const removesRecipe = target.action === "recipe";
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center overflow-y-auto bg-black/60 p-4" data-testid="supply-record-dialog">
      <section role="dialog" aria-modal="true" aria-labelledby="supply-record-dialog-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div><h2 id="supply-record-dialog-title" className="text-xl font-semibold text-stone-950">管理品項</h2><p className="mt-2 text-base font-semibold text-stone-900">{target.name}</p></div>
          <button type="button" autoFocus onClick={onClose} aria-label="關閉管理視窗" className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-700 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200"><X className="h-6 w-6" aria-hidden="true" /></button>
        </div>
        <p className="mt-3 text-sm leading-6 text-stone-600">修改會更新目前資料；{removesRecipe ? "移除配方不會刪除既有庫存流水。" : "停用後仍會保留過去的進貨與庫存紀錄。"}</p>
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button type="button" onClick={onEdit} className="min-h-14 rounded-xl border-2 border-teal-700 bg-teal-50 px-4 text-base font-semibold text-teal-900 hover:bg-teal-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">修改資料</button>
          <button type="button" onClick={onDelete} className="min-h-14 rounded-xl border-2 border-red-300 bg-white px-4 text-base font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-red-100">{removesRecipe ? "移除配方" : "停用資料"}</button>
        </div>
      </section>
    </div>
  );
}

function SupplyDeleteDialog({
  target,
  busy,
  message,
  onCancel,
  onConfirm,
}: {
  target: DeleteTarget;
  busy: boolean;
  message: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const removesRecipe = target.action === "recipe";
  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center overflow-y-auto bg-black/60 p-4" data-testid="supply-delete-dialog">
      <section role="dialog" aria-modal="true" aria-labelledby="supply-delete-dialog-title" className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-2xl">
        <h2 id="supply-delete-dialog-title" className="text-xl font-semibold text-stone-950">{removesRecipe ? "移除配方項目" : "停用資料"}</h2>
        <p className="mt-3 text-base font-semibold text-stone-900">{target.name}</p>
        <p className="mt-2 text-sm leading-6 text-stone-600">
          {removesRecipe
            ? "移除後不再計入此商品配方成本；已入帳的庫存流水與進貨紀錄不受影響。"
            : "系統會保留過去的進貨與庫存紀錄。若仍有庫存、批號或配方關聯，會阻止停用並告知要先處理的項目。"}
        </p>
        {message ? <p role="alert" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">{message}</p> : null}
        <div className="mt-5 grid grid-cols-2 gap-3">
          <button type="button" disabled={busy} onClick={onCancel} className="min-h-12 rounded-xl border-2 border-stone-300 px-4 text-sm font-semibold text-stone-800 disabled:opacity-50">取消</button>
          <button type="button" disabled={busy} onClick={onConfirm} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-red-700 px-4 text-sm font-semibold text-white disabled:opacity-50">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}{removesRecipe ? "確認移除" : "確認停用"}
          </button>
        </div>
      </section>
    </div>
  );
}

function SupplyActionCard({ testId, title, description, icon, onClick }: { testId: string; title: string; description: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <button type="button" data-testid={testId} onClick={onClick} className="group flex min-h-28 w-full items-center gap-4 rounded-xl border-2 border-stone-200 bg-stone-50 p-4 text-left transition hover:border-teal-600 hover:bg-teal-50 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200">
      <span className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-teal-100 text-teal-800 group-hover:bg-teal-700 group-hover:text-white">{icon}</span>
      <span className="min-w-0 flex-1">
        <strong className="block text-base font-semibold text-stone-950">{title}</strong>
        <span className="mt-1 block text-sm leading-5 text-stone-600">{description}</span>
      </span>
      <ChevronRight className="h-6 w-6 shrink-0 text-stone-400 group-hover:text-teal-700" aria-hidden="true" />
    </button>
  );
}

function SupplyActionDialog({ title, description, busy, onClose, children }: { title: string; description: string; busy: boolean; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[80] overflow-y-auto bg-black/60" data-testid="supply-action-dialog">
      <div className="flex min-h-full items-stretch justify-center sm:items-start sm:p-4">
        <section role="dialog" aria-modal="true" aria-labelledby="supply-action-dialog-title" className="flex min-h-dvh w-full max-w-5xl flex-col bg-stone-50 shadow-2xl sm:min-h-0 sm:max-h-[calc(100vh-2rem)] sm:rounded-2xl">
          <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-stone-200 bg-white p-4 sm:rounded-t-2xl sm:p-5">
            <div>
              <h2 id="supply-action-dialog-title" className="text-xl font-semibold text-stone-950">{title}</h2>
              <p className="mt-1 text-sm leading-6 text-stone-600">{description}</p>
            </div>
            <button type="button" autoFocus disabled={busy} onClick={onClose} aria-label="關閉操作視窗" className="inline-flex min-h-12 min-w-12 shrink-0 items-center justify-center rounded-xl border border-stone-300 bg-white text-stone-700 hover:bg-stone-100 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200 disabled:opacity-50">
              <X className="h-6 w-6" aria-hidden="true" />
            </button>
          </header>
          <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">{children}</div>
        </section>
      </div>
    </div>
  );
}

function LargeToggleField({ label, name, description, defaultChecked = false }: { label: string; name: string; description: string; defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return (
    <div className="sm:col-span-2">
      <input type="hidden" name={name} value={checked ? "on" : ""} />
      <button type="button" role="switch" aria-checked={checked} onClick={() => setChecked((current) => !current)} className={`flex min-h-20 w-full items-center gap-3 rounded-xl border-2 p-4 text-left focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-teal-200 ${checked ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>
        <CheckCircle2 className={`h-7 w-7 shrink-0 ${checked ? "text-teal-700" : "text-stone-400"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1"><strong className="block text-sm font-semibold text-stone-950">{label}</strong><span className="mt-1 block text-xs leading-5 text-stone-600">{description}</span></span>
        <span className={`shrink-0 rounded-full px-3 py-1 text-xs font-semibold ${checked ? "bg-teal-700 text-white" : "bg-stone-200 text-stone-700"}`}>{checked ? "已開啟" : "未開啟"}</span>
      </button>
    </div>
  );
}

function SupplyForm({ title, icon, onSubmit, busy, hidden, children }: { title: string; icon: React.ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; hidden: boolean; children: React.ReactNode }) {
  return <form hidden={hidden} onSubmit={onSubmit} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-semibold text-stone-950">{icon}{title}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div><button type="submit" disabled={busy} className="mt-4 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}儲存</button></form>;
}

function Field({ label, name, error, required = true, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string }) {
  const errorId = `${name}-error`;
  return <label className="grid gap-1 text-sm font-medium text-stone-800">{label}<input type={type} name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...props} className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" />{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>;
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return <div className="grid gap-1 text-sm font-medium text-stone-800">{label}<p className="flex min-h-11 items-center rounded-md border border-stone-200 bg-stone-100 px-3 text-stone-700">{value}</p></div>;
}

function SelectField({ label, name, options, error, required = true, defaultValue }: { label: string; name: string; options: readonly (readonly [string, string])[]; error?: string; required?: boolean; defaultValue?: string }) {
  const errorId = `${name}-error`;
  return <label className="grid gap-1 text-sm font-medium text-stone-800">{label}<select name={name} required={required} defaultValue={defaultValue} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className="min-h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100">{options.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select>{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>;
}
