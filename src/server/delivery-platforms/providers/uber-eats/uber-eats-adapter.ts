import { FailClosedDeliveryPlatformAdapter } from "../fail-closed-delivery-platform-adapter";

export class UberEatsAdapter extends FailClosedDeliveryPlatformAdapter {
  readonly provider = "UBER_EATS" as const;

  getConnectionCapabilities() {
    return [
      "OAUTH_CONNECTION",
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
