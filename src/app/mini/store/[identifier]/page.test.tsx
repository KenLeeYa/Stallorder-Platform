import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const mocks=vi.hoisted(()=>({runtime:vi.fn(),resolve:vi.fn(),query:vi.fn(),principal:vi.fn(),member:vi.fn(),identity:vi.fn(),store:vi.fn()}));
vi.mock('@/server/line-platform/runtime',()=>({getLinePlatformRuntime:mocks.runtime}));
vi.mock('@/lib/public-storefront',()=>({resolvePublicStorefront:mocks.resolve}));
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:mocks.query}}));
vi.mock('@/lib/auth',()=>({getPagePrincipal:mocks.principal}));
vi.mock('@/server/line-platform/member-service',()=>({getPlatformMember:mocks.member,hasPlatformIdentity:mocks.identity}));
vi.mock('@/app/store/[identifier]/storefront-page',()=>({default:mocks.store}));
vi.mock('@/components/line-miniapp-login',()=>({LineMiniAppLogin:()=> <p>LINE login required</p>}));
vi.mock('@/components/line-platform-member-form',()=>({LinePlatformMemberForm:()=> <p>Current terms required</p>}));
vi.mock('next/navigation',()=>({notFound:()=>{throw new Error('NOT_FOUND');}}));
import MiniStorePage from './page';
beforeEach(()=>{
  vi.resetAllMocks();mocks.runtime.mockReturnValue({environment:'local',termsVersion:'current',liffId:'123-fixture',endpointUrl:'https://example.test/mini'});
  mocks.resolve.mockResolvedValue({stall:{id:'store-a',name:'Synthetic store'}});mocks.query.mockResolvedValue([{stall_id:'store-a'}]);
  mocks.principal.mockResolvedValue({user:{id:'server-member'}});mocks.member.mockResolvedValue({profile_id:'server-member',terms_version:'current'});mocks.identity.mockResolvedValue(true);
  mocks.store.mockResolvedValue(<p>Store order UI</p>);
});
describe('MINI storefront storage ownership',()=>{
  it.each(['pickup','delivery'])('passes only the current server member to the %s order flow',async view=>{
    await MiniStorePage({params:Promise.resolve({identifier:'store-a'}),searchParams:Promise.resolve({view,platformCustomerId:'forged-member'})});
    expect(mocks.store).toHaveBeenCalledOnce();expect(mocks.store.mock.calls[0][0]).toMatchObject({miniApp:true,platformCustomerId:'server-member'});
  });
  it('does not expose a draft flow before LINE member enrollment',async()=>{
    mocks.member.mockResolvedValue(null);mocks.identity.mockResolvedValue(false);
    const html=renderToStaticMarkup(await MiniStorePage({params:Promise.resolve({identifier:'store-a'}),searchParams:Promise.resolve({view:'pickup'})}));
    expect(html).toContain('LINE login required');expect(mocks.store).not.toHaveBeenCalled();
  });
  it('keeps stale consent terms outside the order flow until reenrollment',async()=>{
    mocks.member.mockResolvedValue({profile_id:'server-member',terms_version:'old'});
    const html=renderToStaticMarkup(await MiniStorePage({params:Promise.resolve({identifier:'store-a'}),searchParams:Promise.resolve({view:'delivery'})}));
    expect(html).toContain('Current terms required');expect(mocks.store).not.toHaveBeenCalled();
  });
});
