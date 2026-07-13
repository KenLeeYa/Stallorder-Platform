import type { OrderStatus, UserRole } from "@prisma/client";

export type Permission =
  | "VIEW_ORDERS"
  | "UPDATE_ORDERS"
  | "CHECKOUT_ORDERS"
  | "MANAGE_PRODUCTS"
  | "MANAGE_ORDERING"
  | "VIEW_REPORTS"
  | "MANAGE_STAFF"
  | "MANAGE_STALL"
  | "PLATFORM_ADMIN";

const rolePermissions: Record<UserRole, readonly Permission[]> = {
  PLATFORM_ADMIN: [
    "VIEW_ORDERS",
    "UPDATE_ORDERS",
    "CHECKOUT_ORDERS",
    "MANAGE_PRODUCTS",
    "MANAGE_ORDERING",
    "VIEW_REPORTS",
    "MANAGE_STAFF",
    "MANAGE_STALL",
    "PLATFORM_ADMIN",
  ],
  MERCHANT_OWNER: [
    "VIEW_ORDERS",
    "UPDATE_ORDERS",
    "CHECKOUT_ORDERS",
    "MANAGE_PRODUCTS",
    "MANAGE_ORDERING",
    "VIEW_REPORTS",
    "MANAGE_STAFF",
    "MANAGE_STALL",
  ],
  MERCHANT_MANAGER: [
    "VIEW_ORDERS",
    "UPDATE_ORDERS",
    "CHECKOUT_ORDERS",
    "MANAGE_PRODUCTS",
    "MANAGE_ORDERING",
    "VIEW_REPORTS",
  ],
  STAFF: ["VIEW_ORDERS", "UPDATE_ORDERS", "CHECKOUT_ORDERS"],
  KITCHEN: ["VIEW_ORDERS", "UPDATE_ORDERS"],
};

const allowedOrderTransitions: Record<OrderStatus, readonly OrderStatus[]> = {
  WAITING_CONFIRMATION: ["CONFIRMED", "CANCELLED"],
  CONFIRMED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
  EXPIRED: [],
};

export function hasPermission(role: UserRole, permission: Permission) {
  return rolePermissions[role].includes(permission);
}

export function canTransitionOrder(current: OrderStatus, next: OrderStatus, role: UserRole) {
  if (!hasPermission(role, "UPDATE_ORDERS")) return false;
  if (!allowedOrderTransitions[current].includes(next)) return false;
  if (role === "KITCHEN") return next === "PREPARING" || next === "READY";
  return true;
}

export const roleLabels: Record<UserRole, string> = {
  PLATFORM_ADMIN: "平台管理員",
  MERCHANT_OWNER: "商戶擁有者",
  MERCHANT_MANAGER: "商戶經理",
  STAFF: "店員",
  KITCHEN: "廚房",
};
