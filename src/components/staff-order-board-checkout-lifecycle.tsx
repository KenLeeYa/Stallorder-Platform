"use client";

import { useCallback, useEffect, useMemo, useReducer } from "react";
import type { UserRole } from "@prisma/client";
import Link from "next/link";
import { TriangleAlert, X } from "lucide-react";
import { StaffDiscountSelector } from "@/components/staff-discount-selector";
import {
  createStaffOrderCheckoutState,
  getStaffOrderCheckoutModel,
  staffOrderCheckoutReducer,
  type StaffOrderCheckoutModules,
  type StaffOrderCheckoutRequest,
  type StaffOrderDiscountOption,
  type StaffOrderPaymentOption,
} from "@/components/staff-order-board-checkout";
import { formatMoney } from "@/lib/money";
import type { StaffOrderDto } from "@/lib/orders";

type CompleteTableCheckoutInput = {
  diningTableId: string;
  checkoutOrders: StaffOrderDto[];
  checkout: StaffOrderCheckoutRequest;
};

type UseStaffOrderCheckoutOptions = {
  modules: StaffOrderCheckoutModules;
  paymentOptions: StaffOrderPaymentOption[];
  discountOptions: StaffOrderDiscountOption[];
  role: UserRole;
  updatingOrderId: string | null;
  onCompleteSingle: (
    order: StaffOrderDto,
    checkout: StaffOrderCheckoutRequest,
  ) => Promise<boolean>;
  onCompleteTable: (input: CompleteTableCheckoutInput) => Promise<boolean>;
  onInvalidTable: () => void;
};

export type StaffOrderCheckoutController = {
  state: ReturnType<typeof createStaffOrderCheckoutState>;
  model: ReturnType<typeof getStaffOrderCheckoutModel>;
  modules: StaffOrderCheckoutModules;
  paymentOptions: StaffOrderPaymentOption[];
  discountOptions: StaffOrderDiscountOption[];
  open: (input: {
    orders: StaffOrderDto[];
    modules: StaffOrderCheckoutModules;
    paymentOptions: StaffOrderPaymentOption[];
  }) => void;
  reconcile: (orders: StaffOrderDto[]) => void;
  dismiss: () => void;
  selectPayment: (paymentOptionId: string | null) => void;
  selectDiscount: (discountOptionId: string | null) => void;
  setCashReceived: (value: string) => void;
  setDiscountApprovalReason: (value: string) => void;
  setManagerEmail: (value: string) => void;
  setManagerPassword: (value: string) => void;
  complete: () => Promise<void>;
};

export function useStaffOrderCheckout({
  modules,
  paymentOptions,
  discountOptions,
  role,
  updatingOrderId,
  onCompleteSingle,
  onCompleteTable,
  onInvalidTable,
}: UseStaffOrderCheckoutOptions): StaffOrderCheckoutController {
  const [state, dispatch] = useReducer(
    staffOrderCheckoutReducer,
    createStaffOrderCheckoutState(),
  );
  const model = useMemo(() => getStaffOrderCheckoutModel({
    state,
    modules,
    paymentOptions,
    discountOptions,
    role,
  }), [discountOptions, modules, paymentOptions, role, state]);
  const checkoutOrder = state.orders[0] ?? null;

  const dismiss = useCallback(() => dispatch({ type: "CLOSE" }), []);
  const open = useCallback((input: {
    orders: StaffOrderDto[];
    modules: StaffOrderCheckoutModules;
    paymentOptions: StaffOrderPaymentOption[];
  }) => dispatch({
    type: "OPEN",
    orders: input.orders,
    modules: input.modules,
    paymentOptions: input.paymentOptions,
  }), []);
  const reconcile = useCallback((orders: StaffOrderDto[]) => {
    dispatch({ type: "RECONCILE_ORDERS", orders });
  }, []);
  const selectPayment = useCallback((paymentOptionId: string | null) => {
    dispatch({ type: "SELECT_PAYMENT", paymentOptionId });
  }, []);
  const selectDiscount = useCallback((discountOptionId: string | null) => {
    dispatch({ type: "SELECT_DISCOUNT", discountOptionId });
  }, []);
  const setCashReceived = useCallback((value: string) => {
    dispatch({ type: "SET_CASH_RECEIVED", value });
  }, []);
  const setDiscountApprovalReason = useCallback((value: string) => {
    dispatch({ type: "SET_DISCOUNT_APPROVAL_REASON", value });
  }, []);
  const setManagerEmail = useCallback((value: string) => {
    dispatch({ type: "SET_MANAGER_EMAIL", value });
  }, []);
  const setManagerPassword = useCallback((value: string) => {
    dispatch({ type: "SET_MANAGER_PASSWORD", value });
  }, []);

  const complete = useCallback(async () => {
    if (state.orders.length === 0) return;
    if (state.orders.length === 1) {
      const completed = await onCompleteSingle(state.orders[0]!, model.request);
      if (completed) dismiss();
      return;
    }

    const diningTableId = state.orders[0]!.diningTableId;
    if (!diningTableId || state.orders.some((order) => order.diningTableId !== diningTableId)) {
      onInvalidTable();
      return;
    }
    const completed = await onCompleteTable({
      diningTableId,
      checkoutOrders: state.orders,
      checkout: model.request,
    });
    if (completed) dismiss();
    else dispatch({ type: "RESET_MANAGER_PASSWORD" });
  }, [dismiss, model.request, onCompleteSingle, onCompleteTable, onInvalidTable, state.orders]);

  useEffect(() => {
    if (!checkoutOrder) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && updatingOrderId !== checkoutOrder.id) dismiss();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [checkoutOrder, dismiss, updatingOrderId]);

  return {
    state,
    model,
    modules,
    paymentOptions,
    discountOptions,
    open,
    reconcile,
    dismiss,
    selectPayment,
    selectDiscount,
    setCashReceived,
    setDiscountApprovalReason,
    setManagerEmail,
    setManagerPassword,
    complete,
  };
}

export function StaffOrderCheckoutDialog({
  controller,
  updatingOrderId,
  currency,
  discountSettingsHref,
  cashShiftHref,
  message,
}: {
  controller: StaffOrderCheckoutController;
  updatingOrderId: string | null;
  currency: string;
  discountSettingsHref?: string;
  cashShiftHref: string;
  message: string;
}) {
  const {
    state,
    model,
    modules,
    paymentOptions,
    discountOptions,
  } = controller;
  const checkoutOrder = state.orders[0] ?? null;
  if (!checkoutOrder) return null;

  const busy = updatingOrderId === checkoutOrder.id;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/45 p-4 print:hidden">
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="checkout-title"
        className="my-auto max-h-[calc(100dvh-2rem)] w-full max-w-lg overflow-y-auto overscroll-contain rounded-lg bg-white p-5 shadow-xl"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="checkout-title" className="text-lg font-semibold">
              {state.orders.length > 1 ? "同桌合併結帳" : "完成訂單"}
            </h2>
            <p className="mt-1 text-sm text-stone-600">
              {state.orders.length > 1
                ? `${checkoutOrder.tableLabel} · ${state.orders.length} 筆訂單`
                : `訂單 ${checkoutOrder.orderNo} · ${checkoutOrder.fulfillmentType === "DINE_IN" ? checkoutOrder.tableLabel : checkoutOrder.customerName}`}
            </p>
            {state.orders.length > 1 ? (
              <p className="mt-1 text-xs text-stone-500">
                {state.orders.map((order) => order.orderNo).join("、")}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            title="關閉結帳視窗"
            disabled={busy}
            onClick={controller.dismiss}
            className="grid h-9 w-9 place-items-center rounded-md border border-stone-300"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="mt-5">
          <h3 className="text-xs font-semibold text-stone-600">付款方式</h3>
          {modules.payment ? (
            paymentOptions.length > 0 ? (
              <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                {paymentOptions.map((option) => (
                  <button
                    key={option.id}
                    type="button"
                    aria-pressed={state.selectedPaymentOptionId === option.id}
                    onClick={() => controller.selectPayment(option.id)}
                    className={`min-h-11 rounded-md border px-3 py-2 text-sm font-semibold ${state.selectedPaymentOptionId === option.id ? "border-teal-700 bg-teal-50 text-teal-900" : "border-stone-300"}`}
                  >
                    {option.name}
                  </button>
                ))}
              </div>
            ) : <p className="mt-2 text-sm text-red-700">尚未設定可用付款方式，請先至攤位設定新增。</p>
          ) : (
            <div className="mt-2 rounded-md border border-stone-300 bg-stone-50 px-3 py-2 text-sm font-semibold">現金</div>
          )}
        </div>

        <StaffDiscountSelector
          enabled={modules.discount}
          options={discountOptions}
          selectedOptionId={state.selectedDiscountOptionId}
          onSelect={controller.selectDiscount}
          settingsHref={discountSettingsHref}
          isApplicable={model.discountEligibleSubtotal > 0}
          existingDiscountLabel={model.preview.discountAmount > 0
            ? model.preview.discountLabel ?? "訂單既有折扣"
            : null}
        />

        {model.discountEligibleSubtotal < model.subtotal ? (
          <p className="mt-2 text-xs text-amber-800">
            折扣適用金額：{formatMoney(model.discountEligibleSubtotal, currency)}；其餘商品不套用訂單折扣。
          </p>
        ) : null}

        {model.needsApproval ? (
          <div className="mt-5 rounded-md border border-amber-300 bg-amber-50 p-4">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-800" />
              <div>
                <h3 className="text-sm font-semibold text-amber-950">此折扣超過店員免核准門檻</h3>
                <p className="mt-1 text-xs text-amber-900">請填寫原因；店員另須由經理輸入帳號密碼驗證。</p>
              </div>
            </div>
            <label className="mt-3 block text-xs font-semibold text-stone-700">
              折扣原因
              <input
                type="text"
                value={state.discountApprovalReason}
                maxLength={200}
                onChange={(event) => controller.setDiscountApprovalReason(event.target.value)}
                className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
              />
            </label>
            {!model.operatorCanApproveDiscount ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <label className="text-xs font-semibold text-stone-700">
                  經理帳號
                  <input
                    type="email"
                    autoComplete="username"
                    value={state.managerEmail}
                    maxLength={254}
                    onChange={(event) => controller.setManagerEmail(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
                  />
                </label>
                <label className="text-xs font-semibold text-stone-700">
                  經理密碼
                  <input
                    type="password"
                    autoComplete="current-password"
                    value={state.managerPassword}
                    maxLength={128}
                    onChange={(event) => controller.setManagerPassword(event.target.value)}
                    className="mt-1 h-10 w-full rounded-md border border-stone-300 bg-white px-3 text-sm"
                  />
                </label>
              </div>
            ) : (
              <p className="mt-3 text-xs font-semibold text-emerald-800">
                您的角色可直接核准，系統仍會記錄操作員與原因。
              </p>
            )}
          </div>
        ) : null}

        <dl className="mt-5 space-y-2 border-y border-stone-200 py-4 text-sm">
          <div className="flex justify-between"><dt>商品小計</dt><dd>{formatMoney(model.subtotal, currency)}</dd></div>
          {model.preview.discountAmount > 0 ? (
            <div className="flex justify-between text-emerald-800">
              <dt>{model.preview.discountLabel ?? "訂單既有折扣"}</dt>
              <dd>-{formatMoney(model.preview.discountAmount, currency)}</dd>
            </div>
          ) : null}
          <div className="flex justify-between text-lg font-semibold"><dt>應收金額</dt><dd>{formatMoney(model.total, currency)}</dd></div>
        </dl>

        {model.usesCash ? (
          <div className="mt-5">
            <label className="text-xs font-semibold text-stone-600" htmlFor="cash-received">客戶實收金額</label>
            <input
              type="text"
              id="cash-received"
              inputMode="numeric"
              maxLength={9}
              pattern="[0-9]{0,9}"
              value={state.cashReceived}
              onChange={(event) => controller.setCashReceived(event.target.value.replace(/\D/g, "").slice(0, 9))}
              placeholder={String(model.total)}
              className="mt-2 h-11 w-full rounded-md border border-stone-300 px-3 text-lg font-semibold"
            />
            <div className="mt-2 grid grid-cols-4 gap-2">
              {[model.total, 200, 500, 1000]
                .filter((value, index, values) => values.indexOf(value) === index)
                .map((value, index) => (
                  <button
                    key={value}
                    type="button"
                    disabled={value < model.total}
                    onClick={() => controller.setCashReceived(String(value))}
                    className="h-10 rounded-md border border-stone-300 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    {index === 0 ? "剛好" : formatMoney(value, currency)}
                  </button>
                ))}
            </div>
            <div className="mt-3 flex justify-between rounded-md bg-emerald-50 px-3 py-3 text-sm font-semibold text-emerald-900">
              <span>找零</span><span>{formatMoney(model.change, currency)}</span>
            </div>
          </div>
        ) : null}

        {message ? (
          <div role="alert" className="mt-5 rounded-md border border-red-300 bg-red-50 p-4 text-sm text-red-900">
            <div className="flex items-start gap-2">
              <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
              <p className="font-semibold">{message}</p>
            </div>
            {message === "現金交易前必須先開啟現金班次。" ? (
              <Link
                href={cashShiftHref}
                className="mt-3 inline-flex min-h-10 items-center rounded-md bg-teal-800 px-4 py-2 font-semibold text-white"
              >
                前往現金交班
              </Link>
            ) : null}
          </div>
        ) : null}

        <div className="mt-6 grid grid-cols-2 gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={controller.dismiss}
            className="rounded-md border border-stone-300 px-3 py-2 text-sm font-medium"
          >
            返回
          </button>
          <button
            type="button"
            disabled={!model.ready || busy}
            onClick={() => void controller.complete()}
            className="rounded-md bg-teal-800 px-3 py-2 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "處理中…" : "完成訂單"}
          </button>
        </div>
      </section>
    </div>
  );
}
