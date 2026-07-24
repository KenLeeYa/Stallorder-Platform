import { DisabledBillingProvider } from "./disabled-billing-provider";

export class EcpayBillingProvider extends DisabledBillingProvider {
  readonly code = "ECPAY";
}
