import type { PaymentOptionKind, UserRole } from "@prisma/client";
import type { StaffOrderDto } from "@/lib/orders";
import { hasPermission } from "@/lib/rbac";
import { getStaffCheckoutPreview } from "@/lib/staff-discount-presentation";

export type StaffOrderCheckoutModules = {
  payment: boolean;
  discount: boolean;
  discountApprovalThresholdBps: number;
};

export type StaffOrderPaymentOption = {
  id: string;
  name: string;
  kind: PaymentOptionKind;
};

export type StaffOrderDiscountOption = {
  id: string;
  name: string;
  rateBps: number;
};

export type StaffOrderCheckoutRequest = {
  paymentOptionId: string | null;
  discountOptionId: string | null;
  cashReceived: number | null;
  discountApprovalReason: string | null;
  managerEmail: string | null;
  managerPassword: string | null;
};

export type StaffOrderCheckoutState = {
  orders: StaffOrderDto[];
  selectedPaymentOptionId: string | null;
  selectedDiscountOptionId: string | null;
  cashReceived: string;
  discountApprovalReason: string;
  managerEmail: string;
  managerPassword: string;
};

type StaffOrderCheckoutAction =
  | {
    type: "OPEN";
    orders: StaffOrderDto[];
    modules: StaffOrderCheckoutModules;
    paymentOptions: StaffOrderPaymentOption[];
  }
  | { type: "RECONCILE_ORDERS"; orders: StaffOrderDto[] }
  | { type: "CLOSE" }
  | { type: "SELECT_PAYMENT"; paymentOptionId: string | null }
  | { type: "SELECT_DISCOUNT"; discountOptionId: string | null }
  | { type: "SET_CASH_RECEIVED"; value: string }
  | { type: "SET_DISCOUNT_APPROVAL_REASON"; value: string }
  | { type: "SET_MANAGER_EMAIL"; value: string }
  | { type: "SET_MANAGER_PASSWORD"; value: string }
  | { type: "RESET_MANAGER_PASSWORD" };

export function createStaffOrderCheckoutState(): StaffOrderCheckoutState {
  return {
    orders: [],
    selectedPaymentOptionId: null,
    selectedDiscountOptionId: null,
    cashReceived: "",
    discountApprovalReason: "",
    managerEmail: "",
    managerPassword: "",
  };
}

export function staffOrderCheckoutReducer(
  state: StaffOrderCheckoutState,
  action: StaffOrderCheckoutAction,
): StaffOrderCheckoutState {
  switch (action.type) {
    case "OPEN": {
      const defaultPayment = action.modules.payment
        ? action.paymentOptions[0] ?? null
        : action.paymentOptions.find((option) => option.kind === "CASH") ?? null;
      return {
        ...createStaffOrderCheckoutState(),
        orders: action.orders,
        selectedPaymentOptionId: defaultPayment?.id ?? null,
      };
    }
    case "RECONCILE_ORDERS":
      return {
        ...state,
        orders: state.orders
          .map((order) => action.orders.find((candidate) => candidate.id === order.id))
          .filter((order): order is StaffOrderDto => Boolean(order)),
      };
    case "CLOSE":
      return createStaffOrderCheckoutState();
    case "SELECT_PAYMENT":
      return {
        ...state,
        selectedPaymentOptionId: action.paymentOptionId,
        cashReceived: "",
      };
    case "SELECT_DISCOUNT":
      return { ...state, selectedDiscountOptionId: action.discountOptionId };
    case "SET_CASH_RECEIVED":
      return { ...state, cashReceived: action.value };
    case "SET_DISCOUNT_APPROVAL_REASON":
      return { ...state, discountApprovalReason: action.value };
    case "SET_MANAGER_EMAIL":
      return { ...state, managerEmail: action.value };
    case "SET_MANAGER_PASSWORD":
      return { ...state, managerPassword: action.value };
    case "RESET_MANAGER_PASSWORD":
      return { ...state, managerPassword: "" };
  }
}

export function getStaffOrderCheckoutModel(input: {
  state: StaffOrderCheckoutState;
  modules: StaffOrderCheckoutModules;
  paymentOptions: StaffOrderPaymentOption[];
  discountOptions: StaffOrderDiscountOption[];
  role: UserRole;
}) {
  const { state, modules, paymentOptions, discountOptions, role } = input;
  const order = state.orders[0] ?? null;
  const discountEligibleSubtotal = state.orders.reduce((orderSum, currentOrder) => (
    orderSum + currentOrder.items.reduce((itemSum, item) => (
      itemSum + (item.isOrderDiscountEligible ? item.unitPrice * item.quantity : 0)
    ), 0)
  ), 0);
  const discount = discountEligibleSubtotal > 0
    ? discountOptions.find((option) => option.id === state.selectedDiscountOptionId) ?? null
    : null;
  const preview = getStaffCheckoutPreview(state.orders.map((currentOrder) => ({
    ...currentOrder,
    discountEligibleSubtotal: currentOrder.items.reduce((sum, item) => (
      sum + (item.isOrderDiscountEligible ? item.unitPrice * item.quantity : 0)
    ), 0),
  })), discount);
  const payment = paymentOptions.find(
    (option) => option.id === state.selectedPaymentOptionId,
  ) ?? null;
  const usesCash = !modules.payment || payment?.kind === "CASH";
  const parsedCashReceived = state.cashReceived === ""
    ? preview.total
    : Number(state.cashReceived);
  const change = usesCash && Number.isFinite(parsedCashReceived)
    ? Math.max(0, parsedCashReceived - preview.total)
    : 0;
  const needsApproval = Boolean(
    discount && discount.rateBps < modules.discountApprovalThresholdBps,
  );
  const operatorCanApproveDiscount = hasPermission(role, "APPROVE_DISCOUNT");
  const ready = Boolean(
    order
    && (!modules.payment || payment)
    && (!usesCash || (
      Number.isInteger(parsedCashReceived)
      && parsedCashReceived >= preview.total
    ))
    && (!needsApproval || (
      state.discountApprovalReason.trim()
      && (
        operatorCanApproveDiscount
        || (state.managerEmail.trim() && state.managerPassword)
      )
    ))
  );
  const request: StaffOrderCheckoutRequest = {
    paymentOptionId: modules.payment ? state.selectedPaymentOptionId : null,
    discountOptionId: modules.discount && discountEligibleSubtotal > 0
      ? state.selectedDiscountOptionId
      : null,
    cashReceived: usesCash && state.cashReceived !== "" ? Number(state.cashReceived) : null,
    discountApprovalReason: state.discountApprovalReason.trim() || null,
    managerEmail: state.managerEmail.trim() || null,
    managerPassword: state.managerPassword || null,
  };

  return {
    order,
    discountEligibleSubtotal,
    preview,
    subtotal: preview.subtotal,
    total: preview.total,
    payment,
    usesCash,
    change,
    needsApproval,
    operatorCanApproveDiscount,
    ready,
    request,
  };
}
