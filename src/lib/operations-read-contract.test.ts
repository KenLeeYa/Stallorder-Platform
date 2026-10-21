import { describe, expect, it } from "vitest";
import { catalogReadInputSchema, clientScopeSchema, pageMetaSchema, productListRowSchema } from "./operations-read-contract";

describe("authorized operations read DTOs", () => {
  it("accepts normalized literal catalog search and rejects unknown sort or fields", () => {
    expect(catalogReadInputSchema.parse({ q: " %_\\ 茶 " }).q).toBe("%_\\ 茶");
    for (const value of [{ sort: "name;drop table" }, { page: 0 }, { pageSize: 200 }, { q: "\n=1" }, { role: "OWNER" }]) {
      expect(catalogReadInputSchema.safeParse(value).success).toBe(false);
    }
  });
  it("excludes secrets and rejects unsorted or duplicate stall scope", () => {
    const scope = { version: "v1", environment: "local", principalKey: "a".repeat(64), sessionEpoch: "b".repeat(64), permissionRevision: "c".repeat(64), context: { kind: "platform" } };
    expect(clientScopeSchema.safeParse(scope).success).toBe(true);
    expect(clientScopeSchema.safeParse({ ...scope, sessionId: "secret" }).success).toBe(false);
    expect(clientScopeSchema.safeParse({ ...scope, context: { kind: "organization", organizationId: "11111111-1111-4111-8111-111111111111", stallIds: ["11111111-1111-4111-8111-111111111111", "11111111-1111-4111-8111-111111111111"] } }).success).toBe(false);
  });
  it("retains empty pagination semantics and requires list projection", () => {
    expect(pageMetaSchema.safeParse({ page: 1, pageSize: 5, total: 0, totalPages: 1, firstItem: 0, lastItem: 0 }).success).toBe(true);
    expect(productListRowSchema.safeParse({ id: "11111111-1111-4111-8111-111111111111", description: "private editor content" }).success).toBe(false);
  });
});
