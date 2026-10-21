import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({exchange:vi.fn(),rate:vi.fn()}));
vi.mock('@/server/line-platform/guest-claim',()=>({exchangeGuestClaimProof:mocks.exchange,guestClaimCookieName:()=> 'synthetic_per_order_cookie'}));
vi.mock('@/lib/rate-limit',()=>({checkPublicRateLimit:mocks.rate}));
import {POST} from './route';
const origin='https://proof.local.test';
const body={orderSessionToken:`stos_${'a'.repeat(43)}`,trackingToken:`sto_${'b'.repeat(43)}`,deviceId:'11111111-1111-4111-8111-111111111111'};
function request(value:unknown=body,headers:Record<string,string>={}){return new Request(`${origin}/api/public/orders/claim-proof`,{method:'POST',headers:{'content-type':'application/json',origin,'x-stallorder-protocol-version':'1','x-real-ip':'203.0.113.1',...headers},body:JSON.stringify(value)});}
beforeEach(()=>{vi.stubEnv('TRUSTED_APP_ORIGINS',origin);vi.stubEnv('NODE_ENV','test');mocks.rate.mockResolvedValue({allowed:true});mocks.exchange.mockResolvedValue('synthetic_encrypted_proof');});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
describe('original-session guest proof HTTP boundary',()=>{
  it('rejects cross-site requests before querying the original order',async()=>{expect((await POST(request(body,{origin:'https://evil.test'}))).status).toBe(403);expect(mocks.exchange).not.toHaveBeenCalled();});
  it('requires the existing public-order protocol',async()=>{expect((await POST(request(body,{'x-stallorder-protocol-version':'0'}))).status).toBe(426);expect(mocks.exchange).not.toHaveBeenCalled();});
  it('rejects oversized or injected identity fields',async()=>{expect((await POST(request({...body,profileId:'attacker'}))).status).toBe(400);expect((await POST(request({...body,extra:'x'.repeat(1500)}))).status).toBe(413);expect(mocks.exchange).not.toHaveBeenCalled();});
  it('rate-limits before capability lookup',async()=>{mocks.rate.mockResolvedValue({allowed:false,retryAfterSeconds:30});expect((await POST(request())).status).toBe(429);expect(mocks.exchange).not.toHaveBeenCalled();});
  it('returns an HTTP-only cookie and never exposes its proof in JSON',async()=>{const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({ok:true});expect(response.headers.get('set-cookie')).toContain('HttpOnly');expect(response.headers.get('cache-control')).toContain('no-store');});
  it('fails the optional exchange without issuing a cookie on secret/configuration errors',async()=>{mocks.exchange.mockRejectedValue(new Error('secret unavailable'));const response=await POST(request());expect(response.status).toBe(503);expect(response.headers.get('set-cookie')).toBeNull();expect(await response.text()).not.toContain('secret');});
});
