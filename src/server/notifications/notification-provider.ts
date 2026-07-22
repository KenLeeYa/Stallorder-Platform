export type NotificationMessage = {
  jobId: string;
  recipient: string;
  text: string;
};

export type NotificationSendResult = {
  providerMessageId: string | null;
};

export interface NotificationProviderAdapter {
  send(message: NotificationMessage): Promise<NotificationSendResult>;
}
export class NotificationProviderError extends Error {
  constructor(
    readonly code: string,
    readonly retryable: boolean,
  ) {
    super(code);
    this.name = "NotificationProviderError";
  }
}
