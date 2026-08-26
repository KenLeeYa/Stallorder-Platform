"use client";

import { type FormEvent, useMemo, useState } from "react";
import { AlertTriangle, Boxes, ChefHat, LoaderCircle, MapPin, PackagePlus } from "lucide-react";
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
      lowStockThresholdMicros: toMicros(data.get("threshold")),
    }, "原料已建立。");
    if (ok) form.reset();
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
            <p className="mt-1">目前不會自動依訂單扣料，也不會同步 ERP；先用人工進貨、調整與耗損驗證配方及流水帳後，再另行核准自動扣料。</p>
          </div>
        </div>
      </section>

      <section aria-label="Supply Lite 摘要" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {[
          ["原料", dashboard.ingredients.length],
          ["庫位", dashboard.locations.length],
          ["商品配方", dashboard.recipeComponents.length],
          ["低庫存", lowStockCount],
        ].map(([label, value]) => (
          <article key={label} className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
            <p className="text-sm text-stone-600">{label}</p>
            <p className="mt-1 text-2xl font-semibold text-stone-950">{value}</p>
          </article>
        ))}
      </section>

      {message ? <p role="status" className={`rounded-lg border p-3 text-sm ${Object.keys(fieldErrors).length ? "border-red-200 bg-red-50 text-red-800" : "border-teal-200 bg-teal-50 text-teal-900"}`}>{message}</p> : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <SupplyForm title="新增原料" icon={<PackagePlus className="h-5 w-5" />} onSubmit={createIngredient} busy={busy}>
          <Field label="原料代碼" name="code" placeholder="CHICKEN_THIGH" error={fieldErrors.code} />
          <Field label="原料名稱" name="name" placeholder="去骨雞腿" error={fieldErrors.name} />
          <SelectField label="基本單位" name="baseUom" error={fieldErrors.baseUom} options={[["G", "公克"], ["KG", "公斤"], ["ML", "毫升"], ["L", "公升"], ["EA", "個／份"]]} />
          <Field label="低庫存門檻（基本單位）" name="threshold" type="number" min="0" step="0.001" defaultValue="0" error={fieldErrors.lowStockThresholdMicros} />
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

      <section className="rounded-xl border border-stone-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-semibold text-stone-950">原料庫存</h2>
        {dashboard.ingredients.length ? (
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {dashboard.ingredients.map((ingredient) => (
              <article key={ingredient.id} className={`rounded-lg border p-3 ${ingredient.lowStock ? "border-amber-300 bg-amber-50" : "border-stone-200"}`}>
                <div className="flex items-start justify-between gap-2">
                  <div><p className="font-semibold text-stone-950">{ingredient.name}</p><p className="text-xs text-stone-500">{ingredient.code}</p></div>
                  {ingredient.lowStock ? <span className="rounded-full bg-amber-100 px-2 py-1 text-xs font-semibold text-amber-900">低庫存</span> : null}
                </div>
                <p className="mt-3 text-xl font-semibold">{units(ingredient.totalQuantityMicros)} <span className="text-sm font-medium text-stone-600">{ingredient.baseUom}</span></p>
                <p className="mt-1 text-xs text-stone-500">門檻 {units(ingredient.lowStockThresholdMicros)} {ingredient.baseUom}</p>
              </article>
            ))}
          </div>
        ) : <p className="mt-3 text-sm text-stone-600">先新增原料與庫位即可開始測試。</p>}
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
