import { beforeEach, describe, expect, it, vi } from 'vitest';
const {init}=vi.hoisted(()=>({init:vi.fn()}));
vi.mock('@line/liff/core',()=>({default:{use(){return this;},init}}));
vi.mock('@line/liff/login',()=>({default:class Login{}}));
vi.mock('@line/liff/is-logged-in',()=>({default:class IsLoggedIn{}}));
vi.mock('@line/liff/get-id-token',()=>({default:class GetIDToken{}}));
vi.mock('@line/liff/get-access-token',()=>({default:class GetAccessToken{}}));
beforeEach(()=>{vi.resetModules();init.mockReset();});
describe('LIFF SDK initialization retry boundary',()=>{
  it('shares one in-flight initialization for concurrent entry and login consumers',async()=>{
    init.mockResolvedValue(undefined);const {initializeMiniApp}=await import('./line-miniapp-liff');
    await Promise.all([initializeMiniApp('123-fixture'),initializeMiniApp('123-fixture')]);
    expect(init).toHaveBeenCalledExactlyOnceWith({liffId:'123-fixture'});
  });
  it('evicts a rejected promise so the visible retry can actually initialize again',async()=>{
    init.mockRejectedValueOnce(new Error('SDK_OFFLINE')).mockResolvedValueOnce(undefined);
    const {initializeMiniApp}=await import('./line-miniapp-liff');
    await expect(initializeMiniApp('123-fixture')).rejects.toThrow('SDK_OFFLINE');
    await expect(initializeMiniApp('123-fixture')).resolves.toBeUndefined();expect(init).toHaveBeenCalledTimes(2);
  });
});
