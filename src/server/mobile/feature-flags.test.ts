import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const resolveFlags=vi.hoisted(()=>vi.fn());
vi.mock("@/server/resilience/feature-flag-service",()=>({resolveResilienceFeatureFlags:resolveFlags}));
vi.mock("@/lib/audit",()=>({logEvent:vi.fn()}));
import {resolveMobileFeatureState} from "./feature-flags";
const id="55555555-5555-4555-8555-555555555551";
beforeEach(()=>{vi.unstubAllEnvs();for(const name of ["VERCEL","VERCEL_ENV","CI","DR_DATABASE_URL","DR_DIRECT_URL"])vi.stubEnv(name,"");vi.stubEnv("APP_URL","http://127.0.0.1:3026");vi.stubEnv("DATABASE_URL","postgresql://local:local@127.0.0.1:56822/postgres");vi.stubEnv("DIRECT_URL","postgresql://local:local@127.0.0.1:56822/postgres");vi.stubEnv("MOBILE_LOCAL_TEST_PROFILE_IDS",id);resolveFlags.mockImplementation(async(codes:string[])=>Object.fromEntries(codes.map(code=>[code,{enabled:false}])));});
afterEach(()=>vi.unstubAllEnvs());
describe("local pilot authentication availability",()=>{
 it("exposes only authentication availability before a principal exists",async()=>{const flags=await resolveMobileFeatureState();expect(flags.localPilot).toBe(true);expect(flags.mobileApp).toBe(false);expect(flags.platformAdmin).toBe(false);});
 it("still requires the finite profile allowlist for presentation flags",async()=>{expect((await resolveMobileFeatureState(id)).mobileApp).toBe(true);expect((await resolveMobileFeatureState("55555555-5555-4555-8555-555555555552")).mobileApp).toBe(false);});
 it.each(["VERCEL","VERCEL_ENV","CI"])("denies hosted marker %s",async key=>{vi.stubEnv(key,"present");const flags=await resolveMobileFeatureState(id);expect(flags.localPilot).toBe(false);expect(flags.mobileApp).toBe(false);});
 it("denies a remote DR database even with local primary",async()=>{vi.stubEnv("DR_DATABASE_URL","postgresql://local:local@example.test:56822/postgres");expect((await resolveMobileFeatureState()).localPilot).toBe(false);});
 it("keeps failed flag lookup closed",async()=>{resolveFlags.mockRejectedValueOnce(new Error("offline"));const flags=await resolveMobileFeatureState(id);expect(flags.localPilot).toBe(false);expect(flags.mobileApp).toBe(false);});
});
