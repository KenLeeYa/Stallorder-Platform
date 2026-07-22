import type { NotificationProviderAdapter } from "./notification-provider";
import { NotificationProviderError } from "./notification-provider";

export class FutureEmailProvider implements NotificationProviderAdapter {
  async send(): Promise<never> {
    throw new NotificationProviderError("EMAIL_PROVIDER_NOT_ENABLED", false);
  }
}
