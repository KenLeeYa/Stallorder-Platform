import "server-only";
import { createHash } from "node:crypto";
import type { SessionPrincipal } from "@/lib/auth";
import type { WorkspaceOrganization } from "@/lib/workspace";
import { clientScopeSchema } from "@/lib/operations-read-contract";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function createOperationsScope(principal: SessionPrincipal, workspace?: WorkspaceOrganization, selectedStallIds?: string[]) {
  const grants = workspace ? { id: workspace.id, status: workspace.status, roles: [...workspace.roles].sort(), canUseAllStalls: workspace.canUseAllStalls, stalls: workspace.stalls.map((s) => ({ id: s.id, isActive: s.isActive, roles: [...s.roles].sort() })).sort((a, b) => a.id.localeCompare(b.id)) } : null;
  return clientScopeSchema.parse({ version: "v1", environment: process.env.VERCEL_ENV === "production" ? "production" : process.env.VERCEL_ENV === "preview" ? "preview" : "local", principalKey: digest(["principal", principal.user.id]), sessionEpoch: digest(["session", principal.sessionId]), permissionRevision: digest([principal.user.platformRole, grants]), context: workspace ? { kind: "organization", organizationId: workspace.id, stallIds: [...new Set(selectedStallIds ?? workspace.stalls.map((s) => s.id))].sort() } : { kind: "platform" } });
}
