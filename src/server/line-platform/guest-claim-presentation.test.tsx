import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const mocks=vi.hoisted(()=>({cookies:vi.fn(),query:vi.fn(),member:vi.fn(),runtime:vi.fn()}));
vi.mock('next/headers',()=>({cookies:mocks.cookies}));
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:mocks.query}}));
vi.mock('@/lib/auth',()=>({getPagePrincipal:vi.fn(async()=>({user:{id:'synthetic'}}))}));
vi.mock('./member-service',()=>({getPlatformMember:mocks.member,bindPlatformOrderOwner:vi.fn()}));
vi.mock('./runtime',()=>({getLinePlatformRuntime:mocks.runtime}));
import {guestClaimCookieName,issueGuestClaimProof} from './guest-claim';
import PublicOrderPage from '@/app/order/[trackingToken]/page';
const tokenA=`sto_${'a'.repeat(43)}`,tokenB=`sto_${'b'.repeat(43)}`,device='11111111-1111-4111-8111-111111111111';
const jar=new Map<string,string>();
beforeEach(()=>{
  vi.clearAllMocks();jar.clear();vi.stubEnv('LINE_PLATFORM_DATA_KEY',Buffer.alloc(32,47).toString('base64'));
  mocks.runtime.mockReturnValue({environment:'local',providerId:'1234567',termsVersion:'v1'});
  mocks.member.mockResolvedValue({profile_id:'synthetic',environment:'local',provider_id:'1234567',subject_hash:'synthetic-hash',terms_version:'v1'});
  // An unclaimed guest order has no platform owner. Only the independently
  // proof-gated eligibility query may return this fixture.
  mocks.query.mockImplementation(async (sql:TemplateStringsArray)=>sql.join('').includes('join public.line_platform_order_owners')?[]:[{id:'synthetic-order'}]);
  mocks.cookies.mockResolvedValue({get:(name:string)=>jar.has(name)?{value:jar.get(name)}:undefined});
  jar.set('stallorder_device',device);
});
afterEach(()=>vi.unstubAllEnvs());
const page=(trackingToken=tokenA)=>PublicOrderPage({params:Promise.resolve({trackingToken})});
describe('guest tracker only offers a claim backed by the matching original proof',()=>{
  it('hides claim without proof and does not query private eligibility',async()=>{expect((await page()).props.platformClaim).toBeUndefined();expect(mocks.query).toHaveBeenCalledTimes(1);expect(mocks.query.mock.calls[0][0].join('')).toContain('join public.line_platform_order_owners');});
  it('does not accept another order proof under the requested cookie name',async()=>{jar.set(guestClaimCookieName(tokenA),issueGuestClaimProof('synthetic-session',tokenB,device)!);expect((await page()).props.platformClaim).toBeUndefined();expect(mocks.query).toHaveBeenCalledTimes(1);expect(mocks.query.mock.calls[0][0].join('')).toContain('join public.line_platform_order_owners');});
  it('preserves proof for both orders and shows current-member claim separately',async()=>{
    for(const token of [tokenA,tokenB])jar.set(guestClaimCookieName(token),issueGuestClaimProof('synthetic-session',token,device)!);
    expect((await page(tokenA)).props.platformClaim).toEqual({member:true});expect((await page(tokenB)).props.platformClaim).toEqual({member:true});
  });
  it('requires current terms before showing the direct claim button',async()=>{jar.set(guestClaimCookieName(tokenA),issueGuestClaimProof('synthetic-session',tokenA,device)!);mocks.member.mockResolvedValue({terms_version:'old'});expect((await page()).props.platformClaim).toEqual({member:false});});
  it('keeps the original tracker when optional runtime or DB eligibility fails',async()=>{
    mocks.runtime.mockImplementationOnce(()=>{throw new Error('invalid optional config');});expect((await page()).props.trackingToken).toBe(tokenA);
    jar.set(guestClaimCookieName(tokenA),issueGuestClaimProof('synthetic-session',tokenA,device)!);mocks.query.mockRejectedValue(new Error('optional DB unavailable'));
    const result=await page();expect(result.props.trackingToken).toBe(tokenA);expect(result.props.platformClaim).toBeUndefined();
  });
});
