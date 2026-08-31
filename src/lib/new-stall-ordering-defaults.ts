import type { QrLocale } from "@/lib/qr-order-i18n";

const defaultEnabledLocales = ["zh-TW"] satisfies QrLocale[];

export function newStallOrderingSettings(organizationId: string) {
  return {
    organizationId,
    dineInEnabled: false,
    deliveryModuleEnabled: false,
    deliveryCustomerNotice: "",
    staffDeliveryEnabled: false,
    printModuleEnabled: false,
    kdsModuleEnabled: false,
    paymentModuleEnabled: true,
    discountModuleEnabled: false,
    takeoutPreorderEnabled: false,
    preorderMinLeadMinutes: 5,
    lotteryEnabled: false,
    lotterySpendRewardEnabled: false,
    lotterySpendThresholdAmount: 666,
    lotteryFestivalRewardEnabled: false,
    lotteryFestivalStartsOn: null,
    lotteryFestivalEndsOn: null,
    lotteryBirthdayRewardEnabled: false,
    enabledLocales: [...defaultEnabledLocales],
  };
}
