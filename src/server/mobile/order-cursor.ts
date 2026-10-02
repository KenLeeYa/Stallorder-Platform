import "server-only";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MobileOrderCursor = { updatedAt: Date; id: string };

export function encodeMobileOrderCursor(cursor: MobileOrderCursor) {
  return Buffer.from(JSON.stringify({ updatedAt: cursor.updatedAt.toISOString(), id: cursor.id }))
    .toString("base64url");
}

export function decodeMobileOrderCursor(value: string): MobileOrderCursor | null {
  if (!/^[A-Za-z0-9_-]{16,512}$/.test(value)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as {
      updatedAt?: unknown;
      id?: unknown;
    };
    if (typeof parsed.updatedAt !== "string" || typeof parsed.id !== "string") return null;
    if (!uuidPattern.test(parsed.id)) return null;
    const updatedAt = new Date(parsed.updatedAt);
    if (Number.isNaN(updatedAt.valueOf()) || updatedAt.toISOString() !== parsed.updatedAt) return null;
    return { updatedAt, id: parsed.id };
  } catch {
    return null;
  }
}
