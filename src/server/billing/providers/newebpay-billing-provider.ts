import { DisabledBillingProvider } from "./disabled-billing-provider";

export class NewebpayBillingProvider extends DisabledBillingProvider {
  readonly code = "NEWEBPAY";
}
