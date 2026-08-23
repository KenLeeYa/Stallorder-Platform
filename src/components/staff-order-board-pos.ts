import type { PaymentOptionKind } from "@prisma/client";
import type { StaffCapacityData } from "@/lib/capacity-contract";
import type { StaffOrderCatalog } from "@/lib/staff-order-contract";

export type StaffOrderPosModules = {
  dineIn: boolean;
  delivery: boolean;
  print: boolean;
  kds: boolean;
  payment: boolean;
  discount: boolean;
  discountApprovalThresholdBps: number;
  preorderReminderMinutes?: number;
  orderAlertSoundPreset?: "URGENT" | "BELL" | "CHIME" | "CUSTOM";
  orderAlertSoundConfigured?: boolean;
  orderAlertVolume?: number;
  orderAlertRepeatCount?: number;
};

export type StaffOrderPosPaymentOption = {
  id: string;
  name: string;
  kind: PaymentOptionKind;
};

export type StaffOrderPosDiscountOption = {
  id: string;
  name: string;
  rateBps: number;
};

export type StaffOrderPosConfiguration = {
  modules: StaffOrderPosModules;
  paymentOptions: StaffOrderPosPaymentOption[];
  discountOptions: StaffOrderPosDiscountOption[];
  catalog: StaffOrderCatalog | null;
};

export type StaffOrderPosSnapshot = StaffOrderPosConfiguration & {
  capacity: StaffCapacityData | null;
};

type LoadStaffOrderPosConfigurationInput = {
  stallSlug: string;
  includeCatalog?: boolean;
  fetchImpl?: typeof fetch;
};

export async function loadStaffOrderPosConfiguration({
  stallSlug,
  includeCatalog = false,
  fetchImpl = fetch,
}: LoadStaffOrderPosConfigurationInput): Promise<StaffOrderPosConfiguration> {
  const response = await fetchImpl(
    `/api/stalls/${stallSlug}/pos-configuration${includeCatalog ? "?includeCatalog=true" : ""}`,
    { cache: "no-store" },
  );
  const payload = await response.json() as StaffOrderPosConfiguration & { error?: string };
  if (!response.ok) {
    throw new Error(payload.error ?? "目前無法更新店員點餐設定。");
  }
  return payload;
}

export function selectStaffOrderPosSnapshot(
  current: StaffOrderPosSnapshot,
  latest: StaffOrderPosConfiguration | null,
): StaffOrderPosSnapshot {
  if (!latest) return current;
  return {
    ...latest,
    catalog: latest.catalog ?? current.catalog,
    capacity: current.capacity,
  };
}

export function prepareStaffOrderComposerIntake(
  current: StaffOrderPosSnapshot,
  latest: StaffOrderPosConfiguration | null,
): StaffOrderPosSnapshot | null {
  const snapshot = selectStaffOrderPosSnapshot(current, latest);
  return snapshot.catalog ? snapshot : null;
}
