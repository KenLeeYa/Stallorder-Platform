import type { NotificationProviderAdapter } from "./notification-provider";
import { NotificationProviderError } from "./notification-provider";

export class FutureWebPushProvider implements NotificationProviderAdapter {
  async send(): Promise<never> {
    throw new NotificationProviderError("WEB_PUSH_PROVIDER_NOT_ENABLED", false);
  }
}
