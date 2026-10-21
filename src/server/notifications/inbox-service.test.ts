import { beforeEach, expect, it, vi } from "vitest";
import type { SessionPrincipal } from "@/lib/auth";
const mocks = vi.hoisted(() => ({ session: vi.fn(), notifications: vi.fn(), count: vi.fn(), preferences: vi.fn() }));
vi.mock("@/lib/prisma", () => {
  const db = { authSession: { findFirst: mocks.session }, merchantApplicationNotification: { findMany: mocks.notifications, count: mocks.count }, notificationPreference: { findUnique: mocks.preferences } };
  return { prisma: { ...db, $transaction: (callback: (value: unknown) => unknown) => callback(db) } };
});
import { listInbox } from "./inbox-service";
const profileId = "11111111-1111-4111-8111-111111111111";
const principal = { sessionId: "session", user: { id: profileId } } as SessionPrincipal;
const query = { scope: { kind: "PERSONAL" }, limit: 1, from: "2026-09-01T00:00:00Z", to: "2026-09-30T00:00:00Z" };
beforeEach(() => {
  vi.stubEnv("TOKEN_DERIVATION_SECRET", "synthetic-inbox-cursor-unit-secret");
  mocks.session.mockResolvedValue({ profileSessionVersion: 1, profile: { id: profileId, isActive: true, sessionVersion: 1 } });
  mocks.preferences.mockResolvedValue(null); mocks.count.mockResolvedValue(2);
  mocks.notifications.mockResolvedValue([1, 2].map(n => ({ id: `22222222-2222-4222-8222-22222222222${n}`, applicationId: profileId, title: "通知", message: "測試", createdAt: new Date("2026-09-20T00:00:00Z"), personalReadReceipts: [] })));
});
it("accepts ISO timestamps without fractional seconds and preserves signed page window", async () => {
  const first = await listInbox(principal, query);
  expect(first.nextCursor).toContain(".");
  const next = await listInbox(principal, { ...query, cursor: first.nextCursor });
  expect(next.from).toBe(first.from); expect(next.to).toBe(first.to);
  const selection = mocks.notifications.mock.calls.at(-1)?.[0];
  expect(selection.cursor).toEqual({ id: first.items[0].id });
  expect(selection.skip).toBe(1);
  expect(selection.where.OR).toBeUndefined();
  expect(mocks.count.mock.calls.at(-2)?.[0].where).toMatchObject({ id: first.items[0].id, profileId, createdAt: { gte: new Date(first.from), lt: new Date(first.to) } });
});
it("rejects an anchor which no longer belongs to the current source filter", async () => {
  const first = await listInbox(principal, { ...query, unreadOnly: true });
  mocks.count.mockResolvedValueOnce(0);
  const calls = mocks.notifications.mock.calls.length;
  await expect(listInbox(principal, { ...query, unreadOnly: true, cursor: first.nextCursor })).rejects.toMatchObject({ status: 400, code: "INBOX_CURSOR_INVALID" });
  expect(mocks.notifications).toHaveBeenCalledTimes(calls);
  expect(mocks.count.mock.calls.at(-1)?.[0].where.personalReadReceipts).toEqual({ none: { profileId } });
});
it("rejects changed payload, signature, filters and recipient before source reads", async () => {
  const first = await listInbox(principal, query);
  const [payload, signature] = first.nextCursor!.split(".");
  const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, "base64url").toString()), id: profileId })).toString("base64url");
  for (const cursor of [`${forged}.${signature}`, `${payload}.invalid`, `${first.nextCursor}.extra`]) await expect(listInbox(principal, { ...query, cursor })).rejects.toMatchObject({ status: 400 });
  await expect(listInbox(principal, { ...query, unreadOnly: true, cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
  mocks.session.mockResolvedValue({ profileSessionVersion: 1, profile: { id: "33333333-3333-4333-8333-333333333333", isActive: true, sessionVersion: 1 } });
  await expect(listInbox(principal, { ...query, cursor: first.nextCursor })).rejects.toMatchObject({ status: 400 });
});
it("rejects revoked session and unavailable signing material without accepting unsigned pagination", async () => {
  mocks.session.mockResolvedValue(null);
  await expect(listInbox(principal, query)).rejects.toMatchObject({ status: 401 });
  mocks.session.mockResolvedValue({ profileSessionVersion: 1, profile: { id: profileId, isActive: true, sessionVersion: 1 } });
  vi.stubEnv("TOKEN_DERIVATION_SECRET", "");
  await expect(listInbox(principal, query)).rejects.toMatchObject({ status: 503 });
});
