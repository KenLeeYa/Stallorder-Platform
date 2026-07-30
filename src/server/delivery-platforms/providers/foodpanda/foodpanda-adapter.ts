import { FailClosedDeliveryPlatformAdapter } from "../fail-closed-delivery-platform-adapter";

export class FoodpandaAdapter extends FailClosedDeliveryPlatformAdapter {
  readonly provider = "FOODPANDA" as const;

  getConnectionCapabilities() {
    return [
      "PARTNER_MANAGED_CONNECTION",
      "STORE_LISTING",
      "MENU_PUSH",
      "AVAILABILITY_PUSH",
      "ORDER_WEBHOOK",
      "ORDER_ACCEPT",
      "ORDER_REJECT",
      "ORDER_PREPARING",
      "ORDER_READY",
      "ORDER_RECONCILIATION",
      "PAYMENT_BREAKDOWN",
    ] as const;
  }
}
