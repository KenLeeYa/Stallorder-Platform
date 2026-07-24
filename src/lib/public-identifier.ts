export const PUBLIC_IDENTIFIER_MIN_LENGTH = 3;
export const PUBLIC_IDENTIFIER_MAX_LENGTH = 50;
export const PUBLIC_IDENTIFIER_PATTERN = "[a-z0-9][a-z0-9-]{1,48}[a-z0-9]";
export const PUBLIC_IDENTIFIER_REGEX = new RegExp(`^${PUBLIC_IDENTIFIER_PATTERN}$`);

export function isValidPublicIdentifier(value: string) {
  return PUBLIC_IDENTIFIER_REGEX.test(value);
}
