"use client";

import { type FormEvent, useMemo, useState } from "react";
import { AlertTriangle, Boxes, Building2, ChefHat, ClipboardList, LoaderCircle, MapPin, PackagePlus, Plus, Trash2, TrendingUp } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { parseFieldErrors } from "@/lib/form-field-errors";
import type { getSupplyDashboard } from "@/server/supply-lite/supply-service";

type SupplyDashboard = Awaited<ReturnType<typeof getSupplyDashboard>>;

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
};

function units(micros: string) {
  return new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 3 }).format(Number(micros) / 1_000_000);
}

function toMicros(value: FormDataEntryValue | null) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 1_000_000) : Number.NaN;
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
  const ingredientNames = useMemo(
    () => new Map(dashboard.ingredients.map((item) => [item.id, item.name])),
    [dashboard.ingredients],
  );
  const locationNames = useMemo(
    () => new Map(dashboard.locations.map((item) => [item.id, item.name])),
    [dashboard.locations],
  );

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
        setMessage(payload.error ?? "目前無法更新 Supply Lite。" );
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
      operation: "CREATE_INGREDIENT",
      code: data.get("code"),
      name: data.get("name"),
      baseUom: data.get("baseUom"),
      itemType: data.get("itemType"),
      trackExpiry: data.get("trackExpiry") === "on",
      defaultShelfLifeDays: data.get("defaultShelfLifeDays") ? Number(data.get("defaultShelfLifeDays")) : null,
      preferredSupplierId: data.get("preferredSupplierId") || null,
      lowStockThresholdMicros: toMicros(data.get("threshold")),
    }, "原料已建立。");
    if (ok) form.reset();
  }

  async function createSupplier(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await sendCommand({
      operation: "CREATE_SUPPLIER",
      code: data.get("code"),
      name: data.get("name"),
      contactName: data.get("contactName") || null,
      phone: data.get("phone") || null,
      email: data.get("email") || null,
      paymentTermsDays: Number(data.get("paymentTermsDays") || 0),
      leadTimeDays: Number(data.get("leadTimeDays") || 0),
    }, "廠商資料已建立。");
    if (ok) form.reset();
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
    }
  }

  async function createLocation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const locationType = String(data.get("locationType"));
    const ok = await sendCommand({
      operation: "CREATE_LOCATION",
      code: data.get("code"),
      name: data.get("name"),
      locationType,
      stallId: locationType === "STALL" ? data.get("stallId") || null : null,
    }, "庫位已建立。");
    if (ok) form.reset();
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
    if (ok) form.reset();
  }

  async function saveRecipe(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const ok = await sendCommand({
      operation: "UPSERT_RECIPE_COMPONENT",
      productId: data.get("productId"),
      ingredientId: data.get("ingredientId"),
      quantityMicros: toMicros(data.get("quantity")),
      wasteBasisPoints: Math.round(Number(data.get("wastePercent")) * 100),
    }, "商品配方已更新。");
    if (ok) form.reset();
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

      <section aria-label="Supply Lite 摘要" className="grid grid-cols-2 gap-3 lg:grid-cols-4 xl:grid-cols-7">
        {[
          ["食材／包材／耗材", dashboard.ingredients.length],
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

      <div className="grid gap-4 xl:grid-cols-2">
        <SupplyForm title="新增食材／包材／耗材" icon={<PackagePlus className="h-5 w-5" />} onSubmit={createIngredient} busy={busy}>
          <Field label="原料代碼" name="code" placeholder="CHICKEN_THIGH" error={fieldErrors.code} />
          <Field label="原料名稱" name="name" placeholder="去骨雞腿" error={fieldErrors.name} />
          <SelectField label="基本單位" name="baseUom" error={fieldErrors.baseUom} options={[["G", "公克"], ["KG", "公斤"], ["ML", "毫升"], ["L", "公升"], ["EA", "個／份"]]} />
          <SelectField label="品項類型" name="itemType" error={fieldErrors.itemType} options={Object.entries(itemTypeLabels)} />
          <SelectField label="主要廠商（選填）" name="preferredSupplierId" required={false} error={fieldErrors.preferredSupplierId} options={[["", "尚未指定"], ...dashboard.suppliers.map((supplier) => [supplier.id, supplier.name] as const)]} />
          <Field label="預設保存天數（選填）" name="defaultShelfLifeDays" type="number" min="1" max="3650" required={false} error={fieldErrors.defaultShelfLifeDays} />
          <label className="flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm font-medium"><input type="checkbox" name="trackExpiry" className="h-5 w-5" />追蹤批號與有效日期</label>
          <Field label="低庫存門檻（基本單位）" name="threshold" type="number" min="0" step="0.001" defaultValue="0" error={fieldErrors.lowStockThresholdMicros} />
        </SupplyForm>

        <SupplyForm title="新增進貨廠商" icon={<Building2 className="h-5 w-5" />} onSubmit={createSupplier} busy={busy}>
          <Field label="廠商代碼" name="code" placeholder="SUPPLIER_A" error={fieldErrors.code} />
          <Field label="廠商名稱" name="name" placeholder="安心食材行" error={fieldErrors.name} />
          <Field label="聯絡人（選填）" name="contactName" required={false} />
          <Field label="電話（選填）" name="phone" type="tel" required={false} />
          <Field label="Email（選填）" name="email" type="email" required={false} />
          <Field label="付款天數" name="paymentTermsDays" type="number" min="0" max="365" defaultValue="0" />
          <Field label="前置天數" name="leadTimeDays" type="number" min="0" max="365" defaultValue="0" />
        </SupplyForm>

        <SupplyForm title="新增庫位" icon={<MapPin className="h-5 w-5" />} onSubmit={createLocation} busy={busy}>
          <Field label="庫位代碼" name="code" placeholder="CENTRAL_01" error={fieldErrors.code} />
          <Field label="庫位名稱" name="name" placeholder="中央冷藏庫" error={fieldErrors.name} />
          <SelectField label="庫位類型" name="locationType" error={fieldErrors.locationType} options={Object.entries(locationTypeLabels)} />
          <SelectField label="攤位（僅攤位庫位必填）" name="stallId" error={fieldErrors.stallId} required={false} options={[["", "不指定"] as const, ...dashboard.stalls.map((stall) => [stall.id, stall.name] as const)]} />
        </SupplyForm>

        <SupplyForm title="庫存異動" icon={<Boxes className="h-5 w-5" />} onSubmit={postMovement} busy={busy}>
          <SelectField label="原料" name="ingredientId" error={fieldErrors.ingredientId} options={dashboard.ingredients.map((item) => [item.id, `${item.name}（${item.baseUom}）`] as const)} />
          <SelectField label="庫位" name="locationId" error={fieldErrors.locationId} options={dashboard.locations.map((item) => [item.id, item.name] as const)} />
          <SelectField label="異動類型" name="movementType" options={Object.entries(movementLabels)} />
          <Field label="數量（輸入正數，系統依類型判斷加減）" name="quantity" type="number" min="0.000001" step="0.001" error={fieldErrors.quantityDeltaMicros} />
          <Field label="單位成本（選填）" name="unitCost" type="number" min="0" step="0.000001" required={false} error={fieldErrors.unitCostMicros} />
          <Field label="異動原因" name="reason" placeholder="例行進貨" error={fieldErrors.reason} />
        </SupplyForm>

        <SupplyForm title="商品配方" icon={<ChefHat className="h-5 w-5" />} onSubmit={saveRecipe} busy={busy}>
          <SelectField label="商品" name="productId" error={fieldErrors.productId} options={dashboard.products.map((item) => [item.id, item.name] as const)} />
          <SelectField label="原料" name="ingredientId" error={fieldErrors.ingredientId} options={dashboard.ingredients.map((item) => [item.id, item.name] as const)} />
          <Field label="每份用量（基本單位）" name="quantity" type="number" min="0.000001" step="0.001" error={fieldErrors.quantityMicros} />
          <Field label="耗損率（%）" name="wastePercent" type="number" min="0" max="100" step="0.01" defaultValue="0" error={fieldErrors.wasteBasisPoints} />
        </SupplyForm>
      </div>

      <form onSubmit={receivePurchase} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
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

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="flex items-center gap-2 text-lg font-semibold"><TrendingUp className="h-5 w-5 text-teal-700" />商品配方毛利</h2>
        <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">{dashboard.productCosts.map((product) => <article key={product.productId} className={`rounded-lg border p-3 ${product.recipeComplete ? "border-stone-200" : "border-amber-300 bg-amber-50"}`}><div className="flex items-start justify-between gap-3"><div><p className="font-semibold">{product.productName}</p><p className="text-xs text-stone-500">售價 ${product.sellingPrice.toLocaleString("zh-TW")} · 配方成本 ${product.recipeCostAmount.toLocaleString("zh-TW")}</p></div><strong className={product.grossProfit >= 0 ? "text-teal-700" : "text-red-700"}>{(product.grossMarginBasisPoints / 100).toFixed(1)}%</strong></div><p className="mt-2 text-sm">單份毛利 ${product.grossProfit.toLocaleString("zh-TW")}</p>{!product.recipeComplete ? <p className="mt-2 text-xs font-semibold text-amber-900">尚未建立配方，毛利不可採信。</p> : null}</article>)}</div>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">批號與新鮮度</h2><div className="mt-3 space-y-2">{dashboard.inventoryLots.map((lot) => { const days = lot.expiresOn ? Math.ceil((Date.parse(`${lot.expiresOn}T00:00:00Z`) - Date.parse(`${dashboard.asOfDate}T00:00:00Z`)) / 86_400_000) : null; return <div key={lot.id} className={`rounded-lg border p-3 text-sm ${days !== null && days < 0 ? "border-red-300 bg-red-50" : days !== null && days <= 7 ? "border-amber-300 bg-amber-50" : "border-stone-200"}`}><div className="flex justify-between gap-2"><strong>{ingredientNames.get(lot.ingredientId) ?? "未知品項"} · {lot.lotNumber}</strong><span>{units(lot.remainingQuantityMicros)}</span></div><p className="mt-1 text-stone-600">{lot.expiresOn ? `有效日期 ${lot.expiresOn}${days !== null ? `（${days < 0 ? `逾期 ${Math.abs(days)} 天` : `剩 ${days} 天`}）` : ""}` : "未設定有效日期"}</p></div>; })}{!dashboard.inventoryLots.length ? <p className="text-sm text-stone-600">尚無批號庫存。</p> : null}</div></article>
        <article className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="text-lg font-semibold">最近進貨單</h2><div className="mt-3 space-y-2">{dashboard.purchaseOrders.map((order) => <div key={order.id} className="rounded-lg border border-stone-200 p-3 text-sm"><div className="flex justify-between gap-3"><strong>{order.documentNumber}</strong><strong>${order.totalAmount.toLocaleString("zh-TW")}</strong></div><p className="mt-1 text-stone-600">{order.supplierName} · {order.orderedOn} · {order.lineCount} 項</p></div>)}{!dashboard.purchaseOrders.length ? <p className="text-sm text-stone-600">尚無進貨單。</p> : null}</div></article>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">食材、包材與耗材庫存</h2>
        {dashboard.ingredients.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {dashboard.ingredients.map((ingredient) => (
              <article key={ingredient.id} className={`rounded-lg border p-3 ${ingredient.lowStock ? "border-amber-300 bg-amber-50" : "border-stone-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold text-stone-950">{ingredient.name}</p><p className="text-xs text-stone-500">{itemTypeLabels[ingredient.itemType] ?? ingredient.itemType} · {ingredient.code}</p></div>
                  {ingredient.lowStock ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">低庫存</span> : null}
                </div>
                <p className="mt-3 text-xl font-semibold">{units(ingredient.totalQuantityMicros)} <span className="text-sm font-medium text-stone-600">{ingredient.baseUom}</span></p>
                <p className="mt-1 text-xs text-stone-500">門檻 {units(ingredient.lowStockThresholdMicros)} {ingredient.baseUom}</p>
              </article>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-stone-600">先新增品項與庫位即可開始測試。</p>}
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">最近庫存流水</h2>
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

function SupplyForm({ title, icon, onSubmit, busy, children }: { title: string; icon: React.ReactNode; onSubmit: (event: FormEvent<HTMLFormElement>) => void; busy: boolean; children: React.ReactNode }) {
  return <form onSubmit={onSubmit} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm"><h2 className="flex items-center gap-2 text-lg font-semibold text-stone-950">{icon}{title}</h2><div className="mt-4 grid gap-3 sm:grid-cols-2">{children}</div><button type="submit" disabled={busy} className="mt-4 inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-md bg-stone-950 px-4 text-sm font-semibold text-white disabled:opacity-50">{busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null}儲存</button></form>;
}

function Field({ label, name, error, required = true, type = "text", ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; name: string; error?: string }) {
  const errorId = `${name}-error`;
  return <label className="grid gap-1 text-sm font-medium text-stone-800">{label}<input type={type} name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} {...props} className="min-h-11 min-w-0 rounded-md border border-stone-300 px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100" />{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>;
}

function SelectField({ label, name, options, error, required = true }: { label: string; name: string; options: readonly (readonly [string, string])[]; error?: string; required?: boolean }) {
  const errorId = `${name}-error`;
  return <label className="grid gap-1 text-sm font-medium text-stone-800">{label}<select name={name} required={required} aria-invalid={Boolean(error)} aria-describedby={error ? errorId : undefined} className="min-h-11 min-w-0 rounded-md border border-stone-300 bg-white px-3 outline-none focus:border-teal-600 focus:ring-2 focus:ring-teal-100">{options.map(([value, optionLabel]) => <option key={value} value={value}>{optionLabel}</option>)}</select>{error ? <span id={errorId} className="text-sm text-red-700">{error}</span> : null}</label>;
}
