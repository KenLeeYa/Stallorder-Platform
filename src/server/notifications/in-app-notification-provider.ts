import type {
  NotificationProviderAdapter,
  NotificationSendResult,
} from "./notification-provider";

export class InAppNotificationProvider implements NotificationProviderAdapter {
  async send(): Promise<NotificationSendResult> {
    return { providerMessageId: null };
  }
}
