import { afterEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { assertPreviewDatabasePrincipal, previewPrincipalFailureDetails, readPreviewPrincipalDiagnostic, verifyPreviewDatabasePrincipal } from "./qa-preview-database-principal";

const start = Date.parse("2026-11-05T06:00:00.000Z");
const principal = { schema: "stallorder-database-principal/v1", currentUser: "postgres",
  sessionUser: "postgres", database: "postgres", superuser: false, bypassRls: true,
  helperExists: true, helperExecute: true, observedAt: "2026-11-05T06:00:00.100Z" };
const response = (body: unknown, status=200, cache="private, no-store") =>
  Response.json(body, { status, headers: { "cache-control": cache } });
describe("actual Preview Next database principal", () => {
  it("does not invoke accessors while projecting diagnostic fields", () => {
    const reason = vi.fn(() => "SYNTHETIC_SECRET_SENTINEL");
    const result = readPreviewPrincipalDiagnostic({ previewPrincipalDiagnostic: {
      failure: { stage: "cleanup", get reason() { return reason(); } },
    } });
    expect(result).toEqual({ failure: undefined, finalStage: undefined });
    expect(reason).not.toHaveBeenCalled();
    expect(readPreviewPrincipalDiagnostic(Object.create({ previewPrincipalDiagnostic: {
      failure: { stage: "cleanup", reason: "P2028" },
    } }))).toBeUndefined();
  });
  it("only serializes known diagnostic fields and constant codes", () => {
    const diagnostic = readPreviewPrincipalDiagnostic({ previewPrincipalDiagnostic: {
      failure: { stage: "principal-response", reason: "PREVIEW_PRINCIPAL_INVALID", secret: "private" },
      finalStage: { stage: "cleanup", reason: "P2028", private: "private" }, secret: "private",
    } });
    expect(diagnostic).toEqual({ failure: { stage: "principal-response", reason: "PREVIEW_PRINCIPAL_INVALID" },
      finalStage: { stage: "cleanup", reason: "P2028" } });
    expect(readPreviewPrincipalDiagnostic({ previewPrincipalDiagnostic: {
      failure: { stage: "arbitrary secret", reason: "PREVIEW_SECRET" }, finalStage: "private",
    } })).toEqual({ failure: undefined, finalStage: undefined });
  });
  it("keeps a bounded assertion or Prisma code without exposing error values", () => {
    expect(previewPrincipalFailureDetails(Object.assign(Error("PREVIEW_PRINCIPAL_INVALID\nprivate token value"),
      { actual: "secret", expected: "other secret" }), "principal-response"))
      .toEqual({ stage: "principal-response", reason: "PREVIEW_PRINCIPAL_INVALID" });
    expect(previewPrincipalFailureDetails(Object.assign(Error("connection string with password"), { code: "P2028" }), "cleanup"))
      .toEqual({ stage: "cleanup", reason: "P2028" });
    expect(previewPrincipalFailureDetails(Error("unexpected secret"), "fixture-create"))
      .toEqual({ stage: "fixture-create", reason: "UNCLASSIFIED" });
    expect(previewPrincipalFailureDetails(Error("PREVIEW_" + "SENSITIVE_".repeat(20000)), "fixture-create"))
      .toEqual({ stage: "fixture-create", reason: "UNCLASSIFIED" });
  });
  it("accepts only a fresh protected response from the actual application query", async () => {
    await expect(assertPreviewDatabasePrincipal(response(principal), start, start+200)).resolves.toEqual(principal);
  });
  it.each([
    {currentUser:"supabase_admin"}, {sessionUser:"supabase_admin"}, {database:"other"},
    {superuser:true}, {bypassRls:false}, {helperExists:false}, {helperExecute:false},
    {schema:"other"}, {observedAt:"2026-11-05T05:59:59.999Z"},
    {observedAt:"2026-11-05T06:00:00.201Z"}, {observedAt:"invalid"},
  ])("rejects wrong privilege, identity, or timestamp %j", async override => {
    await expect(assertPreviewDatabasePrincipal(response({...principal,...override}),start,start+200)).rejects.toThrow("PREVIEW_PRINCIPAL_INVALID");
  });
  it("rejects cacheable and failed responses", async () => {
    await expect(assertPreviewDatabasePrincipal(response(principal,200,"public, max-age=60"),start,start+200)).rejects.toThrow();
    await expect(assertPreviewDatabasePrincipal(response(principal,503),start,start+200)).rejects.toThrow();
  });
});

const input = { origin: "https://stallorder-platform-test123-ada76145-8663s-projects.vercel.app",
  headers: { "x-vercel-protection-bypass": "synthetic-test-only" }, sourceSha: "a".repeat(40),
  ref: "teunnvfakbfzmodajqjz", parentRef: "eyuctbnlvnbnivwasvqr",
  supabaseUrl: "https://teunnvfakbfzmodajqjz.supabase.co",
  databaseUrl: "postgresql://postgres.teunnvfakbfzmodajqjz:example-preview-placeholder@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres" };
function fixture(fault?: "before-commit" | "after-commit" | "principal" | "extra-audit" | "extra-session" | "foreign-bucket") {
  let profile: {id:string;email:string;authUserId:null;platformRole:string|null}|null=null;
  let session=false; let revoked=false; let bucket=false; let audit=false;
  let extraAudit=false; let extraSession=false;
  const calls: string[]=[];
  const db = {
    $queryRaw: vi.fn(async () => [{snapshot: fault==="foreign-bucket" && calls.includes("create") ? "[]" : '[{"foreign":"expired"}]'}]),
    profile: {
      create: vi.fn(async ({data}: {data: {id:string;email:string;platformRole:string}}) => {
        calls.push("create");
        if(fault==="before-commit") throw Error("uncertain");
        profile={...data,authUserId:null}; session=true;
        extraAudit=fault==="extra-audit"; extraSession=fault==="extra-session";
        if(fault==="after-commit") throw Error("uncertain");
        return profile;
      }),
      update: vi.fn(async () => { profile!.platformRole=null; }),
      findUnique: vi.fn(async () => profile && ({email:profile.email,authUserId:null})),
      delete: vi.fn(async () => { profile=null; extraAudit=false; extraSession=false; }), count: vi.fn(async () => profile?1:0),
    },
    authSession: {update:vi.fn(async () => {revoked=true;}),deleteMany:vi.fn(async () => {session=false;}),count:vi.fn(async()=>Number(session)+Number(extraSession))},
    rateLimitBucket: {deleteMany:vi.fn(async () => {bucket=false;}),count:vi.fn(async()=>bucket?1:0)},
    auditLog: {deleteMany:vi.fn(async () => {audit=false;}),count:vi.fn(async()=>Number(audit)+Number(extraAudit))},
    $transaction: async (fn:(tx:unknown)=>Promise<void>) => fn(db),
  };
  const fetchImpl=vi.fn<typeof fetch>(async (url, init) => {
    calls.push(String(url));
    if(String(url).endsWith("/api/version")) return Response.json({revision:input.sourceSha});
    if(!new Headers(init?.headers).has("cookie") || revoked) return response({error:"denied"},401);
    bucket=true;
    if(profile?.platformRole!=="PLATFORM_ADMIN") {audit=true;return response({error:"denied"},404);}
    if(fault==="principal") return response({error:"unavailable"},503);
    return response({...principal,observedAt:new Date().toISOString()});
  });
  return {db:db as unknown as PrismaClient,fetchImpl,calls,empty:()=>!profile&&!session&&!bucket&&!audit};
}
describe("owned isolated principal probe lifecycle", () => {
  afterEach(()=>vi.unstubAllEnvs());
  const enable=()=>{vi.stubEnv("GITHUB_ACTIONS","true");vi.stubEnv("VERCEL_ENV","preview");vi.stubEnv("GITHUB_REPOSITORY","KenLeeYa/Stallorder-Platform");};
  it("exercises actual endpoint authorization and cleans only its generated fixture", async () => {
    enable();const f=fixture();
    const receipt=await verifyPreviewDatabasePrincipal(f.db,input,f.fetchImpl);
    expect(receipt).toMatchObject({anonymousDenied:true,nonAdminDenied:true,revokedSessionDenied:true,ownedProbeCleanupVerified:true,foreignRateBucketsPreserved:true,productionRuntimeVerified:false});
    expect(f.empty()).toBe(true);expect(f.fetchImpl).toHaveBeenCalledTimes(5);
    expect(JSON.stringify(receipt)).not.toContain("synthetic-test-only");
  });
  it.each(["before-commit","after-commit","principal"] as const)("reconciles owned fixture after %s failure",async fault=>{
    enable();const f=fixture(fault);
    await expect(verifyPreviewDatabasePrincipal(f.db,input,f.fetchImpl)).rejects.toThrow();
    expect(f.empty()).toBe(true);
  });
  it.each(["extra-audit","extra-session"] as const)("refuses destructive FK masking of %s",async fault=>{
    enable();const f=fixture(fault);
    await expect(verifyPreviewDatabasePrincipal(f.db,input,f.fetchImpl)).rejects.toThrow("PREVIEW_PRINCIPAL_CLEANUP_INCOMPLETE");
    expect(f.db.profile.delete).not.toHaveBeenCalled();
  });
  it("fails qualification on any foreign bucket change even when owned cleanup succeeds",async()=>{
    enable();const f=fixture("foreign-bucket");
    await expect(verifyPreviewDatabasePrincipal(f.db,input,f.fetchImpl)).rejects.toThrow("PREVIEW_PRINCIPAL_FOREIGN_BUCKET_CHANGED");
    expect(f.empty()).toBe(true);
  });
  it("refuses parent, DR, source mismatch, and non-GitHub use before creating a fixture",async()=>{
    const f=fixture();
    await expect(verifyPreviewDatabasePrincipal(f.db,input,f.fetchImpl)).rejects.toThrow();
    enable();
    for(const ref of ["eyuctbnlvnbnivwasvqr","daeqwtpaxcebmtwxqdkj","a".repeat(20)]) {
      await expect(verifyPreviewDatabasePrincipal(f.db,{...input,ref},f.fetchImpl)).rejects.toThrow();
    }
    await expect(verifyPreviewDatabasePrincipal(f.db,{...input,sourceSha:"b".repeat(40)},f.fetchImpl)).rejects.toThrow("PREVIEW_PRINCIPAL_SOURCE_INVALID");
    expect(f.calls).not.toContain("create");expect(f.empty()).toBe(true);
  });
});
