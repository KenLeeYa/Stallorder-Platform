import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { operationsKey, OperationsReadError, retryOperationsRead, retryAfterDeadline, readQueryOptions, retryOperationsReadNow, disposeOperationsReadDeadlines } from "./operations-query";
import { applicationReadResultSchema, catalogEditorResultSchema } from "./operations-read-contract";
import type { ClientScope } from "./operations-read-contract";
const scope: ClientScope = { version: "v1", environment: "local", principalKey: "a".repeat(64), sessionEpoch: "b".repeat(64), permissionRevision: "c".repeat(64), context: { kind: "platform" } };
const body = { version: "v1" as const, scope, rows: [], pagination: { page: 1, pageSize: 5 as const, total: 0, totalPages: 1, firstItem: 0, lastItem: 0 } };
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("operations read lifecycle", () => {
  it("manual toolbar/editor retry cannot bypass the full deadline", () => {
    vi.useFakeTimers(); vi.setSystemTime(1000);
    const read = vi.fn(); const error = new OperationsReadError(429, "wait", 121000);
    retryOperationsReadNow(error, read); expect(read).not.toHaveBeenCalled();
    vi.setSystemTime(120999); retryOperationsReadNow(error, read); expect(read).not.toHaveBeenCalled();
    vi.setSystemTime(121000); retryOperationsReadNow(error, read); expect(read).toHaveBeenCalledTimes(1);
    retryOperationsReadNow(null, read); expect(read).toHaveBeenCalledTimes(2);
  });
  it("separates principal, session and permission keys", () => {
    const key = operationsKey(scope, "applications", { page: 1 });
    for (const field of ["principalKey", "sessionEpoch", "permissionRevision"] as const) expect(operationsKey({ ...scope, [field]: "d".repeat(64) }, "applications", { page: 1 })).not.toEqual(key);
  });
  it("waits the full Retry-After seconds or HTTP date", () => {
    expect(retryAfterDeadline("90", 1000)).toBe(91000);
    expect(retryAfterDeadline("Thu, 01 Oct 2026 03:00:00 GMT", 0)).toBe(Date.parse("2026-10-01T03:00:00Z"));
    expect(retryAfterDeadline("invalid", 0)).toBeNull();
  });
  it("retries at most twice and never denial/conflict/schema or abort", () => {
    for (const status of [400, 401, 403, 404, 409, 422]) expect(retryOperationsRead(0, new OperationsReadError(status, "request failed"))).toBe(false);
    expect(retryOperationsRead(0, new OperationsReadError(0, "schema", null, "schema"))).toBe(false);
    expect(retryOperationsRead(0, new DOMException("aborted", "AbortError"))).toBe(false);
    expect(retryOperationsRead(1, new OperationsReadError(503, "temporary"))).toBe(true);
    expect(retryOperationsRead(2, new OperationsReadError(503, "temporary"))).toBe(false);
  });
  it("actual QueryClient reads discard a denied scope without retry", async () => {
    const fetch = vi.fn(async () => Response.json({ error: "concealed" }, { status: 404 }));
    vi.stubGlobal("fetch", fetch); const deny = vi.fn(); const client = new QueryClient();
    await expect(client.fetchQuery(readQueryOptions(scope,"applications",{},"/private",applicationReadResultSchema,{ current: () => true, deny }))).rejects.toMatchObject({ status: 404 });
    expect(fetch).toHaveBeenCalledTimes(1); expect(deny).toHaveBeenCalledTimes(1); client.clear();
  });
  it.each(["2", "Thu, 01 Oct 2026 03:00:02 GMT"])("actual QueryClient waits full 429 deadline %s", async (header) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-01T03:00:00Z"));
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, { status: 429, headers: { "retry-after": header } })).mockResolvedValueOnce(Response.json(body));
    vi.stubGlobal("fetch", fetch); const client = new QueryClient();
    const pending = client.fetchQuery(readQueryOptions(scope,"applications",{},"/private",applicationReadResultSchema));
    await vi.advanceTimersByTimeAsync(1999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); await expect(pending).resolves.toEqual(body); expect(fetch).toHaveBeenCalledTimes(2); client.clear();
  });
  it("disposes a late response when the transport ignores cancellation", async () => {
    let resolve!: (response: Response) => void;
    vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>((done) => { resolve = done; })));
    const client = new QueryClient(); let current = true;
    const pending = client.fetchQuery(readQueryOptions(scope,"applications",{},"/private",applicationReadResultSchema,{ current: () => current, deny: vi.fn() })).catch(() => null);
    current = false; await client.cancelQueries(); client.clear(); resolve(Response.json(body)); await pending;
    await Promise.resolve(); expect(client.getQueryCache().getAll()).toHaveLength(0);
  });
});

for (const trigger of ['onFocus','onOnline'] as const) {
  it.each(['120', 'Thu, 01 Oct 2026 03:02:00 GMT'])(`automatic ${trigger} waits retained deadline then revalidates: %s`, async header => {
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
    const fetch = vi.fn().mockResolvedValueOnce(Response.json({}, {status:429, headers:{'retry-after':header}})).mockResolvedValue(Response.json(body));
    vi.stubGlobal('fetch',fetch); const client=new QueryClient(); const options=readQueryOptions(scope,'applications',{},'/private',applicationReadResultSchema);
    client.setQueryData(options.queryKey,body); const observer=new QueryObserver(client,options); const unsubscribe=observer.subscribe(()=>{});
    await observer.refetch(); const query=client.getQueryCache().find({queryKey:options.queryKey})!; query[trigger]();
    await vi.advanceTimersByTimeAsync(119999); expect(fetch).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1); expect(fetch).toHaveBeenCalledTimes(2); expect(client.getQueryData(options.queryKey)).toEqual(body);
    unsubscribe();client.clear();
  });
}
it('authority disposal aborts a retained deadline without another fetch',async()=>{
  vi.useFakeTimers();vi.setSystemTime(1000);vi.stubGlobal('fetch',vi.fn(async()=>Response.json({}, {status:429,headers:{'retry-after':'120'}})));
  const client=new QueryClient(),options=readQueryOptions(scope,'applications',{},'/private',applicationReadResultSchema);client.setQueryData(options.queryKey,body);
  const observer=new QueryObserver(client,options);const unsubscribe=observer.subscribe(()=>{});await observer.refetch();client.getQueryCache().find({queryKey:options.queryKey})!.onFocus();
  await client.cancelQueries();client.clear();await vi.advanceTimersByTimeAsync(120000);expect(fetch).toHaveBeenCalledTimes(1);expect(client.getQueryCache().getAll()).toHaveLength(0);unsubscribe();
});

it('recreating mounted options preserves query-owned deadline',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000);const fetch=vi.fn().mockResolvedValueOnce(Response.json({}, {status:429,headers:{'retry-after':'120'}})).mockResolvedValue(Response.json(body));vi.stubGlobal('fetch',fetch);const client=new QueryClient();const options=readQueryOptions(scope,'applications',{},'/private',applicationReadResultSchema);client.setQueryData(options.queryKey,body);const observer=new QueryObserver(client,options);const unsubscribe=observer.subscribe(()=>{});await observer.refetch();observer.setOptions(readQueryOptions(scope,'applications',{},'/private',applicationReadResultSchema));client.getQueryCache().find({queryKey:options.queryKey})!.onFocus();await vi.advanceTimersByTimeAsync(119999);expect(fetch).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(fetch).toHaveBeenCalledTimes(2);unsubscribe();client.clear();
});

it.each(['120','Thu, 01 Oct 2026 03:02:00 GMT'])('ordinary editor removal and recreation retains deadline: %s',async header=>{
 vi.useFakeTimers();vi.setSystemTime(new Date('2026-10-01T03:00:00Z'));
 const editorScope:ClientScope={...scope,context:{kind:'organization',organizationId:'00000000-0000-4000-8000-000000000001',stallIds:[]}};
 const editorBody={version:'v1',scope:editorScope,editor:{organizationId:editorScope.context.kind==='organization'?editorScope.context.organizationId:'',operatingMode:'SINGLE_STALL',currency:'TWD',stalls:[],initialCatalog:{categories:[],groups:[],products:[]},initialNoteGroups:[],initialReusableNotes:[],enabledTranslationLocales:[],aiTranslationConfigured:false,aiTranslationProviderLabel:'local'}};
 const fetch=vi.fn().mockResolvedValueOnce(Response.json({}, {status:429,headers:{'retry-after':header}})).mockResolvedValue(Response.json(editorBody));vi.stubGlobal('fetch',fetch);
 const client=new QueryClient(),authority={current:()=>true,deny:vi.fn()},options=()=>({...readQueryOptions(editorScope,'catalog-editor',{},'/api/merchant/organizations/00000000-0000-4000-8000-000000000001/catalog/editor',catalogEditorResultSchema,authority),staleTime:0,gcTime:0,refetchOnWindowFocus:false,refetchOnReconnect:false});
 const first=new QueryObserver(client,options());const stop=first.subscribe(()=>{});await first.refetch();const old=client.getQueryCache().find({queryKey:options().queryKey});stop();client.removeQueries({queryKey:options().queryKey,exact:true});const second=new QueryObserver(client,options()),finish=second.subscribe(()=>{});
 expect(client.getQueryCache().find({queryKey:options().queryKey})).not.toBe(old);await vi.advanceTimersByTimeAsync(119999);expect(fetch).toHaveBeenCalledTimes(1);await vi.advanceTimersByTimeAsync(1);expect(fetch).toHaveBeenCalledTimes(2);expect(second.getCurrentResult().data).toEqual(editorBody);expect(authority.deny).not.toHaveBeenCalled();finish();client.clear();
});

it('disposing scoped authority cancels a recreated wait and releases only that lifetime floor',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000);const fetch=vi.fn().mockResolvedValueOnce(Response.json({}, {status:429,headers:{'retry-after':'120'}})).mockResolvedValue(Response.json(body));vi.stubGlobal('fetch',fetch);const client=new QueryClient();let current=true;const authority={current:()=>current,deny:vi.fn()},options=()=>({...readQueryOptions(scope,'applications',{},'/private',applicationReadResultSchema,authority),staleTime:0,gcTime:0});
 const first=new QueryObserver(client,options()),stop=first.subscribe(()=>{});await first.refetch();stop();client.removeQueries({queryKey:options().queryKey,exact:true});const waiting=new QueryObserver(client,options()),finish=waiting.subscribe(()=>{});await vi.advanceTimersByTimeAsync(0);expect(fetch).toHaveBeenCalledTimes(1);current=false;await client.cancelQueries();client.clear();disposeOperationsReadDeadlines(client);expect(client.getQueryCache().getAll()).toHaveLength(0);
 const next=readQueryOptions(scope,'applications',{},'/private',applicationReadResultSchema,{current:()=>true,deny:vi.fn()});await expect(client.fetchQuery(next)).resolves.toEqual(body);expect(fetch).toHaveBeenCalledTimes(2);await vi.advanceTimersByTimeAsync(120000);expect(fetch).toHaveBeenCalledTimes(2);finish();client.clear();disposeOperationsReadDeadlines(client);
});
it('late old-authority429 cannot restore a floor after new authority starts',async()=>{
 let release!:(response:Response)=>void;const fetch=vi.fn().mockImplementationOnce(()=>new Promise<Response>(r=>{release=r;})).mockImplementation(()=>Promise.resolve(Response.json(body)));vi.stubGlobal('fetch',fetch);const client=new QueryClient();let current=true;const options=()=>({...readQueryOptions(scope,'applications',{},'/private',applicationReadResultSchema,{current:()=>current,deny:vi.fn()}),staleTime:0});const old=client.fetchQuery(options()).catch(()=>null);current=false;await client.cancelQueries();client.clear();disposeOperationsReadDeadlines(client);current=true;await expect(client.fetchQuery(options())).resolves.toEqual(body);release(Response.json({}, {status:429,headers:{'retry-after':'120'}}));await old;await expect(client.fetchQuery(options())).resolves.toEqual(body);expect(fetch).toHaveBeenCalledTimes(3);client.clear();disposeOperationsReadDeadlines(client);
});
