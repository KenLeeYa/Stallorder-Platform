import {
  DEFAULT_APP_LOCALE,
  type AppLocale,
} from "@/lib/app-locale";

export type MessageValues = Record<string, string | number>;

type LocalizedDictionaries<TMessages extends Record<string, string>> = {
  [Locale in Exclude<AppLocale, typeof DEFAULT_APP_LOCALE>]: {
    [Key in keyof TMessages]: string;
  };
};

export function createMessageCatalog<const TMessages extends Record<string, string>>(
  fallbackMessages: TMessages,
  localizedMessages: LocalizedDictionaries<TMessages>,
) {
  type MessageKey = Extract<keyof TMessages, string>;
  type MessageDictionary = Record<MessageKey, string>;

  const messages = {
    [DEFAULT_APP_LOCALE]: fallbackMessages,
    ...localizedMessages,
  } as Record<AppLocale, MessageDictionary>;

  return {
    messages,
    get(
      locale: AppLocale,
      key: MessageKey,
      values: MessageValues = {},
    ) {
      return interpolateMessage(messages[locale][key], values);
    },
  };
}

export function interpolateMessage(message: string, values: MessageValues = {}) {
  return message.replace(/\{([A-Za-z0-9_]+)\}/g, (placeholder, name: string) => (
    Object.prototype.hasOwnProperty.call(values, name) ? String(values[name]) : placeholder
  ));
}
