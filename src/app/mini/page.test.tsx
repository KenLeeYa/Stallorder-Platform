import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
const mocks=vi.hoisted(()=>({runtime:vi.fn(),query:vi.fn(),principal:vi.fn(),member:vi.fn(),identity:vi.fn()}));
vi.mock('@/server/line-platform/runtime',()=>({getLinePlatformRuntime:mocks.runtime}));
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:mocks.query}}));
vi.mock('@/lib/auth',()=>({getPagePrincipal:mocks.principal}));
vi.mock('@/server/line-platform/member-service',()=>({getPlatformMember:mocks.member,hasPlatformIdentity:mocks.identity}));
vi.mock('@/components/line-miniapp-login',()=>({LineMiniAppLogin:()=> <p>LINE login</p>}));
import MiniAppPage from './page';
beforeEach(()=>{
  vi.resetAllMocks();mocks.runtime.mockReturnValue({environment:'local',termsVersion:'current',liffId:'123-fixture',endpointUrl:'https://example.test/mini'});
  mocks.principal.mockResolvedValue(null);mocks.member.mockResolvedValue(null);mocks.identity.mockResolvedValue(false);
  mocks.query.mockResolvedValue([{id:'store-a',name:'Synthetic public menu',code:'public-code',slug:'operator-slug'}]);
});
describe('MINI primary entry server boundary',()=>{
  it('renders the ordinary public store list immediately without a client loading wrapper',async()=>{
    const html=renderToStaticMarkup(await MiniAppPage({searchParams:Promise.resolve({view:'menu'})}));
    expect(html).toContain('Synthetic public menu');expect(html).not.toContain('正在開啟 LINE 點餐');
    expect(html).toContain('/mini/store/public-code?view=menu');expect(html).not.toContain('/mini/store/operator-slug');
  });
  it('gates only the primary liff.state endpoint until SDK initialization resolves',async()=>{
    const html=renderToStaticMarkup(await MiniAppPage({searchParams:Promise.resolve({'liff.state':'/orders/example'})}));
    expect(html).toContain('正在開啟 LINE 點餐');expect(html).not.toContain('Synthetic public menu');expect(html).not.toContain('/orders/example');
  });
  it('keeps the existing unconfigured public entry available without initializing an invalid channel',async()=>{
    mocks.runtime.mockReturnValue(null);
    const html=renderToStaticMarkup(await MiniAppPage({searchParams:Promise.resolve({'liff.state':'/orders/example'})}));
    expect(html).toContain('店家正在準備 LINE 連線設定');expect(html).not.toContain('正在開啟 LINE 點餐');expect(mocks.query).not.toHaveBeenCalled();
  });
});
