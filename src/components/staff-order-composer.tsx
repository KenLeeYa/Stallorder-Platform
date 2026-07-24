"use client";

import { useMemo, useRef, useState } from "react";
import type { PaymentOptionKind, UserRole } from "@prisma/client";
import { List, Minus, Package, Plus, Send, ShoppingCart, Truck, Utensils, X } from "lucide-react";
import { csrfHeaders } from "@/lib/csrf-client";
import { formatMoney } from "@/lib/money";
import { notePriceAdjustment, noteSelectionIsValid, toggleNoteOption } from "@/lib/product-note-selection";
import { hasPermission } from "@/lib/rbac";
import type { StaffOrderDto } from "@/lib/orders";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";

const PHONE_NUMBER = /^\+?[0-9][0-9 ().-]{5,29}$/;

type Props = {
  stall: { slug: string; currency: string };
  catalog: StaffOrderCatalog;
  account: { role: UserRole };
  modules: { dineIn: boolean; delivery: boolean; payment: boolean; discount: boolean; discountApprovalThresholdBps: number };
  paymentOptions: Array<{ id: string; name: string; kind: PaymentOptionKind }>;
  discountOptions: Array<{ id: string; name: string; rateBps: number }>;
  onCreated: (order: StaffOrderDto) => void;
  onClose: () => void;
};

export function StaffOrderComposer({
  stall,
  catalog,
  account,
  modules,
  paymentOptions,
  discountOptions,
  onCreated,
  onClose,
}: Props) {
  const idempotencyKeyRef = useRef(crypto.randomUUID());
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const defaultPayment = modules.payment
    ? paymentOptions[0] ?? null
    : paymentOptions.find((option) => option.kind === "CASH") ?? null;
  const [fulfillmentType, setFulfillmentType] = useState<"TAKEOUT" | "DINE_IN" | "DELIVERY">("TAKEOUT");
  const [diningTableId, setDiningTableId] = useState(catalog.tables[0]?.id ?? "");
  const [customerName, setCustomerName] = useState("");
  const [customerPhone, setCustomerPhone] = useState("");
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [customerNote, setCustomerNote] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});
  const [noteSelections, setNoteSelections] = useState<Record<string, string[]>>({});
  const [paymentTiming, setPaymentTiming] = useState<"PAY_NOW" | "PAY_LATER">("PAY_NOW");
  const [paymentOptionId, setPaymentOptionId] = useState(defaultPayment?.id ?? null);
  const [discountOptionId, setDiscountOptionId] = useState<string | null>(null);
  const [cashReceived, setCashReceived] = useState("");
  const [discountApprovalReason, setDiscountApprovalReason] = useState("");
  const [managerEmail, setManagerEmail] = useState("");
  const [managerPassword, setManagerPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [activePane, setActivePane] = useState<"MENU" | "CART">("MENU");

  const selectedItems = useMemo(() => catalog.products
    .filter((product) => (quantities[product.id] ?? 0) > 0)
    .map((product) => ({
      product,
      quantity: quantities[product.id],
      noteOptionIds: noteSelections[product.id] ?? [],
    })), [catalog.products, noteSelections, quantities]);
  const totalQuantity = selectedItems.reduce((sum, item) => sum + item.quantity, 0);
  const subtotal = selectedItems.reduce((sum, item) => (
    sum + Math.max(0, item.product.price + notePriceAdjustment(item.product.noteGroups, item.noteOptionIds)) * item.quantity
  ), 0);
  const discount = discountOptions.find((option) => option.id === discountOptionId) ?? null;
  const total = Math.round((subtotal * (discount?.rateBps ?? 10_000)) / 10_000);
  const payment = paymentOptions.find((option) => option.id === paymentOptionId) ?? null;
  const usesCash = !modules.payment || payment?.kind === "CASH";
  const received = cashReceived === "" ? total : Number(cashReceived);
  const change = usesCash && Number.isFinite(received) ? Math.max(0, received - total) : 0;
  const needsApproval = Boolean(discount && discount.rateBps < modules.discountApprovalThresholdBps);
  const operatorCanApprove = hasPermission(account.role, "APPROVE_DISCOUNT");
  const categories = [...new Set(catalog.products.map((product) => product.category))];
  const [activeCategory, setActiveCategory] = useState(categories[0] ?? "");

  function switchPane(pane: "MENU" | "CART") {
    setActivePane(pane);
    scrollContainerRef.current?.scrollTo({ top: 0 });
  }

  function setQuantity(productId: string, nextQuantity: number) {
    const current = quantities[productId] ?? 0;
    const nextTotal = totalQuantity - current + nextQuantity;
    const nextUnique = selectedItems.length + (current === 0 && nextQuantity > 0 ? 1 : 0);
    if (
      nextQuantity > catalog.limits.maxItemQuantity
      || nextTotal > catalog.limits.maxTotalQuantity
      || nextUnique > catalog.limits.maxUniqueProducts
    ) {
      setMessage("已達此攤位設定的商品數量上限。");
      return;
    }
    setMessage("");
    setQuantities((currentQuantities) => ({
      ...currentQuantities,
      [productId]: Math.max(0, nextQuantity),
    }));
    if (nextQuantity <= 0) {
      setNoteSelections((currentSelections) => {
        const nextSelections = { ...currentSelections };
        delete nextSelections[productId];
        return nextSelections;
      });
    }
  }

  function selectNoteOption(
    productId: string,
    group: StaffOrderCatalog["products"][number]["noteGroups"][number],
    optionId: string | null,
  ) {
    setNoteSelections((current) => ({
      ...current,
      [productId]: toggleNoteOption(current[productId] ?? [], group, optionId),
    }));
  }

  async function submit() {
    if (selectedItems.length === 0) {
      setMessage("請至少選擇一項商品。");
      return;
    }
    const invalidNotes = selectedItems.find(({ product, noteOptionIds }) => (
      !noteSelectionIsValid(product.noteGroups, noteOptionIds)
    ));
    if (invalidNotes) {
      setMessage(`${invalidNotes.product.name} 的必選註記尚未完成。`);
      return;
    }
    if (fulfillmentType === "DINE_IN" && !diningTableId) {
      setMessage("請選擇內用桌位。");
      return;
    }
    if (customerPhone.trim() && !PHONE_NUMBER.test(customerPhone.trim())) {
      setMessage("聯絡電話格式不正確。");
      return;
    }
    if (fulfillmentType === "DELIVERY" && (!PHONE_NUMBER.test(customerPhone.trim()) || !deliveryAddress.trim())) {
      setMessage("外送訂單必須填寫聯絡電話與地址。");
      return;
    }
    if (paymentTiming === "PAY_NOW") {
      if (modules.payment && !payment) {
        setMessage("請選擇付款方式。");
        return;
      }
      if (usesCash && (!Number.isInteger(received) || received < total)) {
        setMessage("實收金額不可小於應收金額。");
        return;
      }
      if (needsApproval && (!discountApprovalReason.trim()
        || (!operatorCanApprove && (!managerEmail.trim() || !managerPassword)))) {
        setMessage("請完成折扣核准資料。");
        return;
      }
    }

    setBusy(true);
    setMessage("");
    try {
      const fulfillment = fulfillmentType === "DINE_IN"
        ? { fulfillmentType, diningTableId, customerPhone }
        : fulfillmentType === "DELIVERY"
          ? { fulfillmentType, customerPhone, deliveryAddress }
          : { fulfillmentType, customerPhone };
      const response = await fetch(`/api/stalls/${stall.slug}/orders`, {
        method: "POST",
        headers: csrfHeaders(),
        body: JSON.stringify({
          ...fulfillment,
          idempotencyKey: idempotencyKeyRef.current,
          customerName,
          customerNote,
          paymentTiming,
          checkout: paymentTiming === "PAY_NOW" ? {
            paymentOptionId: modules.payment ? paymentOptionId : null,
            discountOptionId: modules.discount ? discountOptionId : null,
            cashReceived: usesCash ? received : null,
            discountApprovalReason: needsApproval ? discountApprovalReason : null,
            managerEmail: needsApproval && !operatorCanApprove ? managerEmail : null,
            managerPassword: needsApproval && !operatorCanApprove ? managerPassword : null,
          } : undefined,
          items: selectedItems.map(({ product, quantity, noteOptionIds }) => ({
            productId: product.id,
            quantity,
            note: "",
            noteOptionIds,
          })),
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error ?? "目前無法建立訂單。");
      onCreated(payload.order as StaffOrderDto);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "目前無法建立訂單。");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div ref={scrollContainerRef} className="fixed inset-0 z-50 overflow-y-auto bg-black/45 print:hidden sm:p-6">
      <section role="dialog" aria-modal="true" aria-labelledby="staff-order-title" className="mx-auto min-h-full w-full max-w-6xl bg-white shadow-xl sm:min-h-0 sm:rounded-lg">
        <header className="sticky top-0 z-20 flex flex-wrap items-start justify-between gap-4 border-b border-stone-200 bg-white px-4 py-4 sm:rounded-t-lg sm:px-6">
          <div>
            <h2 id="staff-order-title" className="text-xl font-semibold">店員點餐與結帳</h2>
            <p className="mt-1 text-sm text-stone-600">現場代點會直接送入廚房，不需要 QR 或取餐 session。</p>
          </div>
          <button type="button" title="關閉店員點餐" disabled={busy} onClick={onClose} className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-stone-300"><X className="h-4 w-4" /></button>
          <div className="grid w-full grid-cols-2 rounded-md border border-stone-300 bg-stone-50 p-1 lg:hidden" aria-label="店員點餐步驟">
            <button data-testid="staff-order-menu-tab" type="button" aria-pressed={activePane === "MENU"} onClick={() => switchPane("MENU")} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded text-sm font-semibold ${activePane === "MENU" ? "bg-white text-stone-950 shadow-sm" : "text-stone-600"}`}><List className="h-4 w-4" />選擇商品</button>
            <button data-testid="staff-order-cart-tab" type="button" aria-pressed={activePane === "CART"} onClick={() => switchPane("CART")} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded text-sm font-semibold ${activePane === "CART" ? "bg-white text-stone-950 shadow-sm" : "text-stone-600"}`}><ShoppingCart className="h-4 w-4" />訂單與結帳 ({totalQuantity})</button>
          </div>
        </header>

        <div className="grid lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className={`${activePane === "MENU" ? "block" : "hidden"} px-4 py-5 pb-28 sm:px-6 lg:block lg:pb-5`}>
            <div className="grid grid-cols-3 gap-2" aria-label="取餐方式">
              <ModeButton active={fulfillmentType === "TAKEOUT"} icon={<Package className="h-4 w-4" />} label="外帶" onClick={() => setFulfillmentType("TAKEOUT")} />
              <ModeButton active={fulfillmentType === "DINE_IN"} disabled={!modules.dineIn || catalog.tables.length === 0} icon={<Utensils className="h-4 w-4" />} label="內用" onClick={() => setFulfillmentType("DINE_IN")} />
              <ModeButton active={fulfillmentType === "DELIVERY"} disabled={!modules.delivery} icon={<Truck className="h-4 w-4" />} label="外送" onClick={() => setFulfillmentType("DELIVERY")} />
            </div>

            <div className="mt-5 grid items-start gap-3 sm:grid-cols-2">
              <TextField className="mt-0" label="顧客名稱（選填）" value={customerName} maxLength={50} autoComplete="name" onChange={setCustomerName} />
              {(fulfillmentType === "TAKEOUT" || fulfillmentType === "DELIVERY") ? <TextField className="mt-0" label={fulfillmentType === "DELIVERY" ? "聯絡電話" : "聯絡電話（選填）"} value={customerPhone} maxLength={30} type="tel" inputMode="tel" autoComplete="tel" pattern="\+?[0-9][0-9 ().-]{5,29}" onChange={setCustomerPhone} /> : null}
              {fulfillmentType === "DINE_IN" ? <label className="block text-xs font-semibold text-stone-600">桌位<select value={diningTableId} onChange={(event) => setDiningTableId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 bg-white px-3 text-sm">{catalog.tables.map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}</select></label> : null}
              {fulfillmentType === "DELIVERY" ? <label className="text-xs font-semibold text-stone-600 sm:col-span-2">外送地址<textarea autoComplete="street-address" value={deliveryAddress} maxLength={300} onChange={(event) => setDeliveryAddress(event.target.value)} className="form-input mt-1 min-h-20" /></label> : null}
            </div>

            <nav aria-label="商品分類" className="-mx-4 mt-6 flex gap-2 overflow-x-auto border-y border-stone-200 px-4 py-2 sm:-mx-6 sm:px-6 lg:hidden">
              {categories.map((category) => <button key={category} type="button" aria-pressed={activeCategory === category} onClick={() => setActiveCategory(category)} className={`min-h-10 shrink-0 rounded-md border px-3 text-sm font-semibold ${activeCategory === category ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white text-stone-700"}`}>{category}</button>)}
            </nav>

            <div className="mt-7 space-y-7">
              {categories.map((category) => (
                <section key={category} className={activeCategory === category ? "block" : "hidden lg:block"}>
                  <h3 className="border-b border-stone-200 pb-2 text-sm font-semibold text-stone-600">{category}</h3>
                  <div className="divide-y divide-stone-100">
                    {catalog.products.filter((product) => product.category === category).map((product) => {
                      const quantity = quantities[product.id] ?? 0;
                      const selected = noteSelections[product.id] ?? [];
                      const unitPrice = Math.max(0, product.price + notePriceAdjustment(product.noteGroups, selected));
                      return <div key={product.id} className="py-4"><div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4"><div className="min-w-0"><h4 className="font-semibold">{product.name}</h4>{product.description ? <p className="mt-1 text-sm text-stone-500">{product.description}</p> : null}<p className="mt-1 text-sm font-semibold">{formatMoney(unitPrice, stall.currency)}</p></div><div className="grid grid-cols-[44px_32px_44px] items-center gap-2"><button type="button" title={`減少 ${product.name}`} disabled={quantity === 0} onClick={() => setQuantity(product.id, quantity - 1)} className="grid h-11 w-11 place-items-center rounded-md border border-stone-300 disabled:opacity-40"><Minus className="h-4 w-4" /></button><span className="text-center font-semibold">{quantity}</span><button type="button" title={`增加 ${product.name}`} onClick={() => setQuantity(product.id, quantity + 1)} className="grid h-11 w-11 place-items-center rounded-md bg-teal-800 text-white"><Plus className="h-4 w-4" /></button></div></div>{quantity > 0 && product.noteGroups.length > 0 ? <div className="mt-4 space-y-3 border-l-2 border-teal-700 pl-3">{product.noteGroups.map((group) => { const optionIds = new Set(group.options.map((option) => option.id)); const selectedCount = selected.filter((id) => optionIds.has(id)).length; return <fieldset key={group.id}><legend className="text-sm font-semibold">{group.name}{group.isRequired ? " *" : ""}<span className="ml-2 text-xs font-normal text-stone-500">{group.selectionMode === "SINGLE" ? "單選" : group.maxSelections ? `最多 ${group.maxSelections} 項` : "複選"}</span></legend><div className="mt-2 flex flex-wrap gap-x-4 gap-y-2">{group.selectionMode === "SINGLE" && !group.isRequired ? <label className="inline-flex min-h-11 items-center gap-2 text-sm"><input type="radio" name={`staff-note-${product.id}-${group.id}`} checked={selectedCount === 0} onChange={() => selectNoteOption(product.id, group, null)} />不選</label> : null}{group.options.map((option) => { const checked = selected.includes(option.id); const maxed = group.maxSelections !== null && selectedCount >= group.maxSelections; return <label key={option.id} className="inline-flex min-h-11 items-center gap-2 text-sm"><input type={group.selectionMode === "SINGLE" ? "radio" : "checkbox"} name={`staff-note-${product.id}-${group.id}`} checked={checked} disabled={group.selectionMode === "MULTIPLE" && maxed && !checked} onChange={() => selectNoteOption(product.id, group, option.id)} />{option.name}{option.priceDelta !== 0 ? <span className="text-teal-800">{option.priceDelta > 0 ? "+" : ""}{formatMoney(option.priceDelta, stall.currency)}</span> : null}</label>; })}</div></fieldset>; })}</div> : null}</div>;
                    })}
                  </div>
                </section>
              ))}
              {catalog.products.length === 0 ? <p className="py-12 text-center text-sm text-stone-500">目前沒有可供應商品。</p> : null}
            </div>
            {selectedItems.length > 0 ? <button data-testid="staff-mobile-cart-summary" type="button" onClick={() => switchPane("CART")} className="safe-area-bottom fixed inset-x-3 bottom-0 z-30 flex min-h-16 items-center gap-3 rounded-t-lg bg-stone-900 px-4 pt-3 text-left text-white shadow-2xl lg:hidden"><ShoppingCart className="h-5 w-5" /><span className="flex-1"><span className="block text-xs text-stone-300">{totalQuantity} 份</span><strong>{formatMoney(total, stall.currency)}</strong></span><span className="text-sm font-semibold">前往結帳</span></button> : null}
          </div>

          <aside data-testid="staff-order-cart-panel" className={`${activePane === "CART" ? "block" : "hidden"} safe-area-bottom border-t border-stone-200 bg-stone-50 px-4 py-5 lg:block lg:border-l lg:border-t-0 sm:px-6`}>
            <div className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-teal-800" /><h3 className="font-semibold">本次訂單</h3><span className="ml-auto text-sm text-stone-500">{totalQuantity} 份</span></div>
            <div className="mt-3 divide-y divide-stone-200 border-y border-stone-200">{selectedItems.map(({ product, quantity, noteOptionIds }) => <div key={product.id} className="py-3 text-sm"><div className="flex justify-between gap-3"><span>{quantity} × {product.name}</span><strong>{formatMoney(Math.max(0, product.price + notePriceAdjustment(product.noteGroups, noteOptionIds)) * quantity, stall.currency)}</strong></div>{noteOptionIds.length > 0 ? <p className="mt-1 text-xs text-teal-800">{product.noteGroups.flatMap((group) => group.options.filter((option) => noteOptionIds.includes(option.id)).map((option) => option.name)).join("、")}</p> : null}</div>)}</div>
            <label className="mt-4 block text-xs font-semibold text-stone-600">訂單備註<textarea value={customerNote} maxLength={catalog.limits.maxNoteLength} onChange={(event) => setCustomerNote(event.target.value)} className="form-input mt-1 min-h-20" /></label>

            <div className="mt-5 grid grid-cols-2 rounded-md border border-stone-300 bg-white p-1" aria-label="付款時間">
              <button type="button" aria-pressed={paymentTiming === "PAY_NOW"} onClick={() => setPaymentTiming("PAY_NOW")} className={`h-9 rounded text-xs font-semibold ${paymentTiming === "PAY_NOW" ? "bg-stone-900 text-white" : "text-stone-600"}`}>立即結帳</button>
              <button type="button" aria-pressed={paymentTiming === "PAY_LATER"} onClick={() => setPaymentTiming("PAY_LATER")} className={`h-9 rounded text-xs font-semibold ${paymentTiming === "PAY_LATER" ? "bg-stone-900 text-white" : "text-stone-600"}`}>稍後結帳</button>
            </div>

            {paymentTiming === "PAY_NOW" ? <>
              {modules.payment ? <div className="mt-4 grid grid-cols-2 gap-2">{paymentOptions.map((option) => <button key={option.id} type="button" aria-pressed={paymentOptionId === option.id} onClick={() => { setPaymentOptionId(option.id); setCashReceived(""); }} className={`min-h-10 rounded-md border px-2 text-xs font-semibold ${paymentOptionId === option.id ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>{option.name}</button>)}</div> : <p className="mt-4 rounded-md border border-stone-300 bg-white px-3 py-2 text-sm font-semibold">現金</p>}
              {modules.discount ? <div className="mt-4 flex flex-wrap gap-2"><button type="button" aria-pressed={discountOptionId === null} onClick={() => setDiscountOptionId(null)} className={`h-9 rounded-md border px-3 text-xs font-semibold ${discountOptionId === null ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>不折扣</button>{discountOptions.map((option) => <button key={option.id} type="button" aria-pressed={discountOptionId === option.id} onClick={() => setDiscountOptionId(option.id)} className={`h-9 rounded-md border px-3 text-xs font-semibold ${discountOptionId === option.id ? "border-teal-700 bg-teal-50" : "border-stone-300 bg-white"}`}>{option.name}</button>)}</div> : null}
              {needsApproval ? <div className="mt-4 border-y border-amber-300 bg-amber-50 py-3"><p className="text-xs font-semibold text-amber-900">此折扣需要經理核准</p><TextField label="核准原因" value={discountApprovalReason} maxLength={200} onChange={setDiscountApprovalReason} />{!operatorCanApprove ? <><TextField label="經理帳號" value={managerEmail} maxLength={254} onChange={setManagerEmail} type="email" autoComplete="username" /><TextField label="經理密碼" value={managerPassword} maxLength={128} onChange={setManagerPassword} type="password" autoComplete="current-password" /></> : null}</div> : null}
              {usesCash ? <div className="mt-4"><TextField label="實收金額" value={cashReceived} maxLength={9} inputMode="numeric" onChange={(value) => setCashReceived(value.replace(/\D/g, ""))} /><div className="mt-2 grid grid-cols-4 gap-2">{[total, 200, 500, 1000].filter((value, index, values) => values.indexOf(value) === index).map((value, index) => <button key={value} type="button" disabled={value < total} onClick={() => setCashReceived(String(value))} className="h-9 rounded-md border border-stone-300 bg-white text-xs font-semibold disabled:opacity-40">{index === 0 ? "剛好" : value}</button>)}</div><div className="mt-3 flex justify-between bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-900"><span>找零</span><span>{formatMoney(change, stall.currency)}</span></div></div> : null}
            </> : null}

            <dl className="mt-5 space-y-2 border-y border-stone-200 py-4 text-sm"><div className="flex justify-between"><dt>商品小計</dt><dd>{formatMoney(subtotal, stall.currency)}</dd></div>{paymentTiming === "PAY_NOW" && discount ? <div className="flex justify-between text-emerald-800"><dt>{discount.name}</dt><dd>-{formatMoney(subtotal - total, stall.currency)}</dd></div> : null}<div className="flex justify-between text-lg font-semibold"><dt>{paymentTiming === "PAY_NOW" ? "應收金額" : "訂單金額"}</dt><dd>{formatMoney(paymentTiming === "PAY_NOW" ? total : subtotal, stall.currency)}</dd></div></dl>
            {message ? <p role="alert" className="mt-4 text-sm text-red-700">{message}</p> : null}
            <button type="button" disabled={busy || selectedItems.length === 0} onClick={() => void submit()} className="mt-5 inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-40"><Send className="h-4 w-4" />{busy ? "建立中…" : paymentTiming === "PAY_NOW" ? "建立訂單並收款" : "建立訂單送入廚房"}</button>
          </aside>
        </div>
      </section>
    </div>
  );
}

function ModeButton({ active, disabled, icon, label, onClick }: { active: boolean; disabled?: boolean; icon: React.ReactNode; label: string; onClick: () => void }) {
  return <button type="button" disabled={disabled} aria-pressed={active} onClick={onClick} className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-35 ${active ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300 bg-white"}`}>{icon}{label}</button>;
}

function TextField({ className = "mt-3", label, value, maxLength, type = "text", inputMode, autoComplete, pattern, onChange }: { className?: string; label: string; value: string; maxLength: number; type?: string; inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"]; autoComplete?: string; pattern?: string; onChange: (value: string) => void }) {
  return <label className={`${className} block text-xs font-semibold text-stone-600`}>{label}<input type={type} inputMode={inputMode} autoComplete={autoComplete} pattern={pattern} value={value} maxLength={maxLength} onChange={(event) => onChange(event.target.value)} className="form-input mt-1" /></label>;
}
