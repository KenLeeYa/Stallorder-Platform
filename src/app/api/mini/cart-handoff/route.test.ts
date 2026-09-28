import {createHash} from 'node:crypto';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({principal:vi.fn(),consume:vi.fn()}));
vi.mock('@/lib/auth',()=>({getRequestPrincipal:mocks.principal,CSRF_COOKIE:'stallorder_csrf'}));
vi.mock('@/lib/rate-limit',()=>({checkRateLimit:vi.fn(async()=>({allowed:true}))}));
vi.mock('@/server/line-platform/runtime',()=>({getLinePlatformRuntime:()=>({environment:'local'})}));
vi.mock('@/server/line-platform/guest-cart',async original=>({...await original<typeof import('@/server/line-platform/guest-cart')>(),consumeGuestCartHandoff:mocks.consume}));
import {POST} from './route';
import {guestCartCookieName} from '@/server/line-platform/guest-cart';
const qr='synthetic-qr-token-at-least-24',origin='https://cart.local.test',csrf='synthetic-csrf';
function request(body:unknown={qrToken:qr,orderingMode:'PREORDER',sealedDraft:'e'.repeat(100)},headers:Record<string,string>={}){return new Request(`${origin}/api/mini/cart-handoff`,{method:'POST',headers:{origin,'content-type':'application/json','x-csrf-token':csrf,cookie:`stallorder_csrf=${csrf}; stallorder_device=synthetic-device; ${guestCartCookieName(qr,'PREORDER')}=opaque-proof`,...headers},body:JSON.stringify(body)});}
beforeEach(()=>{vi.clearAllMocks();vi.stubEnv('TRUSTED_APP_ORIGINS',origin);mocks.principal.mockResolvedValue({user:{id:'server-member'},csrfTokenHash:createHash('sha256').update(csrf).digest('hex')});mocks.consume.mockResolvedValue({draft:'verified-draft'});});
afterEach(()=>vi.unstubAllEnvs());
describe('authenticated cart import route',()=>{
  it('requires the current member and CSRF before decrypting any handoff',async()=>{
    mocks.principal.mockResolvedValueOnce(null);expect((await POST(request())).status).toBe(401);
    expect((await POST(request(undefined,{'x-csrf-token':''}))).status).toBe(403);expect((await POST(request(undefined,{origin:'https://evil.test'}))).status).toBe(403);expect(mocks.consume).not.toHaveBeenCalled();
  });
  it('rejects client-provided identities and oversized bodies',async()=>{
    expect((await POST(request({qrToken:qr,orderingMode:'PREORDER',sealedDraft:'e'.repeat(100),profileId:'forged'}))).status).toBe(400);
    expect((await POST(request({sealedDraft:'e'.repeat(263000)}))).status).toBe(413);expect(mocks.consume).not.toHaveBeenCalled();
  });
  it('uses server member, original device cookie and scoped HttpOnly proof and returns only verified draft',async()=>{
    const response=await POST(request());expect(response.status).toBe(200);expect(await response.json()).toEqual({draft:'verified-draft'});expect(response.headers.get('cache-control')).toContain('no-store');
    expect(mocks.consume).toHaveBeenCalledWith({qrToken:qr,orderingMode:'PREORDER',sealedDraft:'e'.repeat(100)},'synthetic-device','opaque-proof',expect.objectContaining({user:{id:'server-member'}}));
  });
  it('fails closed when the proof or original guest session cannot be verified',async()=>{mocks.consume.mockRejectedValue(new Error('CART_HANDOFF_UNAVAILABLE'));const result=await POST(request());expect(result.status).toBe(400);expect(await result.text()).not.toContain('sealedDraft');});
});
