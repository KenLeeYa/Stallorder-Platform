import { createServer, type ServerResponse } from "node:http";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import type { PrismaClient } from "@prisma/client";
import type { ReportEnvelope } from "@/lib/report-delivery-contract";
import type { ReportProviderEvidence, ReportProviderOutcome } from "@/server/reports/report-email";

type Mode = "ACCEPT" | "REJECT" | "LOSS" | "HOLD" | "PAUSE_BEFORE_TRANSPORT" | "HOLD_ACCEPTED";
const appBinding = process.env.B4B_TEST_REPORT_BINDING === "APP_SIMULATED";
if(appBinding){assert.equal(process.env.REPORT_DELIVERY_MODE,"simulate");assert.equal(process.env.REPORT_FROM_EMAIL,"qa-report@example.test");assert.equal(process.env.RESEND_API_KEY,"");}
const binding = createHash("sha256").update(appBinding ? JSON.stringify(["report-email-v1",true,"qa-report@example.test",""]) : "SIMULATED guarded loopback report provider v1").digest("hex");
const rules = new Map<string, { mode: Mode; hash?: string; accepted: boolean; closed: boolean; released?: () => void; response?: ServerResponse; holdLookup?: boolean; releaseLookup?: () => void }>();
let origin: string | undefined, db: PrismaClient | undefined, allowed: Set<string> | undefined;
export const events: Array<{ key: string; hash: string; binding: string; accepted: boolean; phase: string }> = [];
export function reportProviderBinding() { return { mode: "SIMULATED" as const, binding, from: appBinding ? "qa-report@example.test" : "synthetic@example.test" }; }
export function configureReport(id: string, mode: Mode) { assert.match(id, /^[a-f0-9-]{36}$/); assert.equal(rules.has(`stallorder-report-${id}`), false); rules.set(`stallorder-report-${id}`, { mode, accepted: false, closed: false }); }
export function closeGrant(id: string) { const rule = rules.get(`stallorder-report-${id}`)!; assert.ok(rule && !rule.accepted); rule.closed = true; rule.response?.end(JSON.stringify({ kind: "REJECTED", code: "MOCK_CONFIRMED_NOT_ACCEPTED", retryable: false, grantClosed: true })); }
export function releasePaused(id: string) { const rule=rules.get(`stallorder-report-${id}`)!; rule.mode="REJECT"; rule.released?.(); }
export function holdLookup(id: string) { rules.get(`stallorder-report-${id}`)!.holdLookup=true; }
export function releaseLookup(id: string) { rules.get(`stallorder-report-${id}`)!.releaseLookup?.(); }
export function dropHeldResponse(id: string) { rules.get(`stallorder-report-${id}`)!.response?.destroy(); }
export async function startReportMock(client: PrismaClient, organizations: Set<string>) {
  assert.equal(origin, undefined); db = client; allowed = organizations;
  const server = createServer(async (request, response) => {
    try {
      assert.equal(request.socket.remoteAddress, "127.0.0.1");
      const chunks: Buffer[] = []; for await (const part of request) { chunks.push(Buffer.from(part)); assert.ok(Buffer.concat(chunks).length <= 1000000); }
      const input = JSON.parse(Buffer.concat(chunks).toString()), rule = rules.get(input.key); assert.ok(rule);
      const row = await db!.reportDelivery.findUniqueOrThrow({ where: { id: String(input.key).replace("stallorder-report-", "") } });
      assert.ok(allowed!.has(row.organizationId)); assert.equal(input.binding, binding); assert.equal(input.hash, row.snapshotHash); assert.ok(row.snapshotJson);
      if (rule.hash) assert.equal(rule.hash, input.hash); else rule.hash = input.hash;
      response.setHeader("content-type", "application/json");
      if (request.url === "/lookup") {
        events.push({ key: input.key, hash: input.hash, binding, accepted: rule.accepted, phase: "lookup" });
        const proof = rule.accepted ? { kind: "SIMULATED", messageId: `mock:${input.key}` } : rule.closed ? { kind: "REJECTED" } : { kind: "UNKNOWN" };
        const finish=()=>response.end(JSON.stringify(proof.kind === "UNKNOWN" ? proof : { ...proof, key: input.key, hash: input.hash, binding, reference: `mock-evidence:${input.key}`, checkedAt: new Date().toISOString(), grantClosed: rule.closed }));
        if(rule.holdLookup){rule.releaseLookup=()=>{rule.releaseLookup=undefined;rule.holdLookup=false;finish();};events.push({key:input.key,hash:input.hash,binding,accepted:rule.accepted,phase:"lookup-held"});}else finish(); return;
      }
      assert.equal(request.url, "/send");
      assert.equal(row.effectState, "IN_FLIGHT");
      const snapshot = row.snapshotJson as { envelope: ReportEnvelope }; assert.deepEqual(input.envelope, snapshot.envelope);
      events.push({ key: input.key, hash: input.hash, binding, accepted: false, phase: "request" });
      if (rule.closed) { response.end(JSON.stringify({ kind: "REJECTED", code: "MOCK_GRANT_CLOSED", retryable: false, grantClosed: true })); return; }
      if (rule.mode === "HOLD") { rule.response = response; return; }
      if (rule.mode === "REJECT") { rule.closed = true; response.end(JSON.stringify({ kind: "REJECTED", code: "MOCK_CONFIRMED_NOT_ACCEPTED", retryable: false, grantClosed: true })); return; }
      assert.equal(rule.accepted, false, "No duplicate acceptance allowed"); rule.accepted = true;
      events.push({ key: input.key, hash: input.hash, binding, accepted: true, phase: "accepted" });
      if (rule.mode === "LOSS") { response.destroy(); return; }
      if (rule.mode === "HOLD_ACCEPTED") { rule.response=response; return; }
      response.end(JSON.stringify({ kind: "SIMULATED", messageId: `mock:${input.key}` }));
    } catch (error) { response.statusCode = 500; response.end(JSON.stringify({ error: error instanceof Error ? error.message : "mock-failed" })); }
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const address = server.address(); assert.ok(address && typeof address !== "string"); origin = `http://127.0.0.1:${address.port}`;
  return { origin, close: async () => { for(const rule of rules.values()){rule.released?.();rule.releaseLookup?.();}server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); origin = undefined; } };
}
export async function sendReportEnvelope(input: { envelope: ReportEnvelope; key: string; hash: string; binding: string }): Promise<ReportProviderOutcome> {
  assert.ok(origin); const rule = rules.get(input.key); assert.ok(rule);
  if (rule.mode === "PAUSE_BEFORE_TRANSPORT") { events.push({key:input.key,hash:input.hash,binding,accepted:false,phase:"paused-before-transport"}); await new Promise<void>(resolve => { rule.released = resolve; }); }
  try { const response = await fetch(`${origin}/send`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000), redirect: "error" }); return response.ok ? await response.json() : { kind: "UNKNOWN", code: "MOCK_RESPONSE_UNPROVEN" }; }
  catch { return { kind: "UNKNOWN", code: "EMAIL_RESPONSE_LOST" }; }
}
export async function reconcileReportProvider(input: { key: string; hash: string; binding: string }): Promise<ReportProviderEvidence> {
  assert.ok(origin); const response = await fetch(`${origin}/lookup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input), signal: AbortSignal.timeout(15000), redirect: "error" });
  return response.ok ? response.json() : { kind: "UNKNOWN" };
}
