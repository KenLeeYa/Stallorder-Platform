import type { QrLocale } from "@/lib/qr-order-i18n";

const defaultEnabledLocales = ["zh-TW"] satisfies QrLocale[];

export function newStallOrderingSettings(organizationId: string) {
  return {
    organizationId,
    dineInEnabled: false,
    deliveryModuleEnabled: false,
    staffDeliveryEnabled: false,
    printModuleEnabled: false,
    paymentModuleEnabled: true,
    discountModuleEnabled: false,
    takeoutPreorderEnabled: false,
    lotteryEnabled: false,
    enabledLocales: [...defaultEnabledLocales],
  };
}
