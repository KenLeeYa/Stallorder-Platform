import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PublicMenu } from '@/lib/public-menu-types';

const shared = await vi.hoisted(async () => {
  const { createHookRuntime } = await import('../test/stateful-hook-runtime');
  return { runtime: createHookRuntime(), request: vi.fn(), availability: vi.fn() };
});
vi.mock('react', async (original) => ({...await original<typeof import('react')>(), ...shared.runtime.hooks}));
vi.mock('react/jsx-runtime', async (original) => {
  const actual = await original<typeof import('react/jsx-runtime')>();
  return {...actual, jsx: (...args:Parameters<typeof actual.jsx>) => {args[0]=shared.runtime.wrap(args[0]);return actual.jsx(...args);},
    jsxs: (...args:Parameters<typeof actual.jsxs>) => {args[0]=shared.runtime.wrap(args[0]);return actual.jsxs(...args);}};
});
vi.mock('react/jsx-dev-runtime', async (original) => {
  const actual = await original<typeof import('react/jsx-dev-runtime')>();
  return {...actual, jsxDEV: (...args:Parameters<typeof actual.jsxDEV>) => {args[0]=shared.runtime.wrap(args[0]);return actual.jsxDEV(...args);}};
});
vi.mock('@/lib/public-order-client', async (original) => ({
  ...await original<typeof import('@/lib/public-order-client')>(),
  getOrCreateDeviceId: () => 'synthetic-device',
  getPublicAvailability: shared.availability,
  requestPublicOrder: shared.request,
}));

import { renderToStaticMarkup } from 'react-dom/server';
import { PublicMenuView } from '@/app/store/[identifier]/public-menu-view';
import { useQrOrderFlowController } from './qr-order-flow-controller';
import { persistQrOrderRecovery } from '@/lib/qr-order-recovery';

const closure: NonNullable<PublicMenu["specialClosure"]> = { id: 'owned-closure', startsOn: '2026-10-27', endsOn: '2026-10-27',
  title: 'Closure one', message: '', opensAt: null, closesAt: null, isActive: true };
const menu: PublicMenu = {
  orderingMode: 'DEFAULT', orderingOpenNow: true, onlineMenuPath: '/store/aming-01',
  preorderSlots: [], lotteryEnabled: false, specialClosure: null,
  stall: {name: 'Synthetic', slug: 'different-slug', code: 'aming-01', location: '', currency: 'TWD',
    timezone: 'Asia/Taipei', fulfillmentType: 'TAKEOUT', table: null},
  products: [{id:'p1', name:'Rice', description:'', price:50, kind:'SINGLE', category:'Meals', rank:null,
    isBestSeller:false,isSoldOut:false,isOrderDiscountEligible:true,imageUrl:null,translations:[],noteGroups:[],bundleChoiceGroups:[]}],
  supportedLocales:['en'],estimatedWaitMinutes:1,estimatedWaitMinMinutes:1,estimatedWaitMaxMinutes:1,
  waitAcknowledgmentThresholdMinutes:null,requiresWaitAcknowledgment:false,lastTableOrderAt:null,
  limits:{maxItemQuantity:20,maxUniqueProducts:20,maxTotalQuantity:20,maxNoteLength:100},
};
let documentTarget: EventTarget & {visibilityState: string; documentElement: {lang:string}};
let windowTarget: EventTarget;
let payload: {timezone:string;closures: Array<typeof closure>};
let fetchMock=vi.fn<(url:string,init?:RequestInit)=>Promise<Response>>();
let sessionStarts: number;

beforeEach(() => {
  shared.runtime.reset();
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-27T05:00:00Z'));
  documentTarget = Object.assign(new EventTarget(), {visibilityState:'visible',documentElement:{lang:''}});
  windowTarget = new EventTarget();
  const storage = new Map<string,string>();
  const store = {getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)};
  Object.assign(windowTarget, {setTimeout,clearTimeout,setInterval,clearInterval,localStorage:store,sessionStorage:store,
    location:{origin:'https://synthetic.test',search:'',replace:vi.fn()},
    matchMedia:()=>Object.assign(new EventTarget(),{matches:false}), requestAnimationFrame:(fn:()=>void)=>fn()});
  vi.stubGlobal('document',documentTarget);
  vi.stubGlobal('window',windowTarget);
  vi.stubGlobal('navigator',{language:'en',onLine:true});
  vi.stubGlobal('ResizeObserver',class {observe(){} disconnect(){}});
  payload={timezone:'Asia/Taipei',closures:[]};
  fetchMock=vi.fn(async (url:string,init?:RequestInit)=>{
    if (url!=='/api/public/stores/aming-01/closures') throw new Error('Unexpected endpoint '+url);
    expect(init?.cache).toBe('no-store');
    return Response.json(payload);
  });
  vi.stubGlobal('fetch',fetchMock);
  sessionStarts=0;
  shared.request.mockImplementation(async (name:string)=>{
    if(name!=='create-order-session') throw new Error('Unexpected mutation '+name);
    sessionStarts++;
    return Response.json({...menu,orderSessionToken:'existing-session',expiresAt:'2026-10-27T06:00:00Z'});
  });
  shared.availability.mockResolvedValue({activeBackend:'PRIMARY',promotionEpoch:3,qrOrdering:'AVAILABLE',staffOnline:'AVAILABLE',offlinePos:'AVAILABLE'});
});
afterEach(()=>{shared.runtime.stop();vi.useRealTimers();vi.unstubAllGlobals();vi.clearAllMocks();});

async function settle<T>(render:()=>T) {
  let result!:T;
  for(let i=0;i<16;i++) {result=shared.runtime.render(render); await Promise.resolve();await Promise.resolve();}
  return result;
}
function qr(initialMenu:PublicMenu) {
  const input={qrToken:'synthetic-qr',initialMenu,initialUiLocale:'en' as const,startNewOrder:true};
  return ()=>useQrOrderFlowController(input);
}
function publicMenu(initialMenu:PublicMenu) {
  return ()=>renderToStaticMarkup(<PublicMenuView menu={initialMenu} locale="en" identifier="aming-01" />);
}
async function refresh<T>(render:()=>T) { windowTarget.dispatchEvent(new Event('focus')); return settle(render); }

describe('already-open Menu and QR closure updates',()=>{
  it('supersedes a pending session on a backend switch and ignores its late failure',async()=>{
    let finish!: (response:Response)=>void;
    shared.request.mockImplementationOnce(()=>{sessionStarts++;return new Promise<Response>(resolve=>{finish=resolve;});});
    const render=qr(menu);
    let result=await settle(render);
    expect(sessionStarts).toBe(1);
    shared.availability.mockResolvedValue({activeBackend:'DR',promotionEpoch:4,qrOrdering:'AVAILABLE',staffOnline:'AVAILABLE',offlinePos:'AVAILABLE'});
    result.refreshAvailability();
    result=await settle(render);
    expect(sessionStarts).toBe(2);
    const requests=shared.request.mock.calls.filter(([name])=>name==='create-order-session');
    expect(requests[1][1].sessionRequestId).not.toBe(requests[0][1].sessionRequestId);
    expect(result.session?.orderSessionToken).toBe('existing-session');
    finish(Response.json({code:'ORDER_CREATE_ERROR'},{status:503}));
    result=await settle(render);
    expect(result.orderingAvailability).toBe('AVAILABLE');
    expect(result.orderingEnabled).toBe(true);
    expect(result.session?.orderSessionToken).toBe('existing-session');
    expect(sessionStarts).toBe(2);
  });

  it('keeps same-target requests deduplicated when an older attempt finishes during its replacement',async()=>{
    const pending:Array<(response:Response)=>void>=[];
    shared.request.mockImplementation(()=>{sessionStarts++;return new Promise<Response>(resolve=>pending.push(resolve));});
    const render=qr(menu);
    let result=await settle(render);
    result.refreshAvailability(true);
    result=await settle(render);
    expect(sessionStarts).toBe(1);
    shared.availability.mockResolvedValue({activeBackend:'DR',promotionEpoch:4,qrOrdering:'AVAILABLE',staffOnline:'AVAILABLE',offlinePos:'AVAILABLE'});
    result.refreshAvailability();
    result=await settle(render);
    expect(sessionStarts).toBe(2);
    pending[0](Response.json({code:'ORDER_CREATE_ERROR'},{status:503}));
    result=await settle(render);
    result.refreshAvailability(true);
    result=await settle(render);
    expect(sessionStarts).toBe(2);
    expect(result.session?.orderSessionToken).toBe('');
    pending[1](Response.json({...menu,orderSessionToken:'new-target-session',expiresAt:'2026-10-27T06:00:00Z'}));
    result=await settle(render);
    expect(result.session?.orderSessionToken).toBe('new-target-session');
    result.refreshAvailability(true);
    await settle(render);
    expect(sessionStarts).toBe(3);
  });

  it.each(['pending','ready'])('invalidates the %s old-target session during closure and starts once after reopening',async(state)=>{
    let finish!: (response:Response)=>void;
    if(state==='pending') shared.request.mockImplementationOnce(()=>{sessionStarts++;return new Promise<Response>(resolve=>{finish=resolve;});});
    const render=qr(menu);
    let result=await settle(render);
    if(state==='ready') {
      result.updateQuantity('p1',2);
      result.setCustomerName('Synthetic buyer');
      result=await settle(render);
    }
    const savedCart=structuredClone(result.cartLines);
    payload.closures=[closure];
    result=await refresh(render);
    shared.availability.mockResolvedValue({activeBackend:'DR',promotionEpoch:4,qrOrdering:'AVAILABLE',staffOnline:'AVAILABLE',offlinePos:'AVAILABLE'});
    result.refreshAvailability();
    result=await settle(render);
    expect(sessionStarts).toBe(1);
    expect(result.session?.orderSessionToken).toBe('');
    expect(result.orderingEnabled).toBe(false);
    if(state==='pending') {
      finish(Response.json({...menu,orderSessionToken:'old-target-session',expiresAt:'2026-10-27T06:00:00Z'}));
      result=await settle(render);
      expect(result.session?.orderSessionToken).toBe('');
    }
    payload.closures=[];
    result=await refresh(render);
    expect(sessionStarts).toBe(2);
    expect(result.orderingEnabled).toBe(true);
    expect(result.session?.orderSessionToken).toBe('existing-session');
    expect(result.cartLines).toEqual(savedCart);
    if(state==='ready') expect(result.customerName).toBe('Synthetic buyer');
    const requests=shared.request.mock.calls.filter(([name])=>name==='create-order-session');
    expect(requests[1][1].sessionRequestId).not.toBe(requests[0][1].sessionRequestId);
    await refresh(render);
    expect(sessionStarts).toBe(2);
  });

  it.each([404, 503])('waits for the existing-order recovery decision before reopening (status %s)',async(status)=>{
    const qrToken='synthetic-qr-token-for-recovery';
    const trackingToken='synthetic_tracking_token_for_recovery_1234567890';
    const deviceId='12345678-1234-4234-8234-123456789abc';
    persistQrOrderRecovery(window.localStorage,{qrToken,trackingToken,deviceId});
    let finish!: (response:Response)=>void;
    shared.request.mockImplementation((name:string)=>{
      if(name==='get-public-order') return new Promise<Response>(resolve=>{finish=resolve;});
      if(name!=='create-order-session') throw new Error('Unexpected mutation '+name);
      sessionStarts++;
      return Promise.resolve(Response.json({...menu,orderSessionToken:'existing-session',expiresAt:'2026-10-27T06:00:00Z'}));
    });
    payload.closures=[closure];
    const input={qrToken,initialMenu:{...menu,orderingOpenNow:false,specialClosure:closure},initialUiLocale:'en' as const};
    const render=function useRecoveryFlow(){return useQrOrderFlowController(input);};
    await settle(render);
    expect(shared.request).toHaveBeenCalledWith('get-public-order',{trackingToken,deviceId});
    payload.closures=[];
    await refresh(render);
    expect(sessionStarts).toBe(0);
    finish(new Response(null,{status}));
    await settle(render);
    expect(sessionStarts).toBe(status===404 ? 1 : 0);
    if(status===503) expect(window.location.replace).toHaveBeenCalledWith(`/order/${trackingToken}?qr=${qrToken}`);
    await refresh(render);
    expect(sessionStarts).toBe(status===404 ? 1 : 0);
  });
  it('adds, updates and retracts the Menu notice without navigation',async()=>{
    const render=publicMenu(menu);
    expect(await settle(render)).not.toContain('public-menu-special-closure');
    payload.closures=[closure];
    expect(await refresh(render)).toContain('Closure one');
    payload.closures=[{...closure,title:'Closure changed'}];
    expect(await refresh(render)).toContain('Closure changed');
    payload.closures=[];
    expect(await refresh(render)).not.toContain('public-menu-special-closure');
  });
  it('retracts an initially closed QR and starts one session after reopening',async()=>{
    payload.closures=[closure];
    const render=qr({...menu,orderingOpenNow:false,specialClosure:closure});
    expect((await settle(render)).orderingEnabled).toBe(false);
    expect(sessionStarts).toBe(0);
    payload.closures=[];
    let result=await refresh(render);
    expect(result.session?.specialClosure).toBeNull();
    expect(result.orderingEnabled).toBe(true);
    expect(sessionStarts).toBe(1);
    result=await refresh(render);
    expect(result.session?.orderSessionToken).toBe('existing-session');
    expect(sessionStarts).toBe(1);
  });
  it('updates a QR notice and ordering while retaining the active cart and session',async()=>{
    const render=qr(menu);
    let result=await settle(render);
    expect(result.orderingEnabled).toBe(true);
    result.updateQuantity('p1',2);
    result.setCustomerName('Synthetic buyer');
    result=await settle(render);
    const savedCart=structuredClone(result.cartLines);
    expect(savedCart.length).toBeGreaterThan(0);
    payload.closures=[closure];
    result=await refresh(render);
    expect(result.orderingEnabled).toBe(false);
    expect(result.session?.specialClosure?.title).toBe('Closure one');
    payload.closures=[{...closure,title:'Closure changed'}];
    result=await refresh(render);
    expect(result.session?.specialClosure?.title).toBe('Closure changed');
    payload.closures=[];
    result=await refresh(render);
    expect(result.orderingEnabled).toBe(true);
    expect(result.cartLines).toEqual(savedCart);
    expect(result.customerName).toBe('Synthetic buyer');
    expect(result.session?.orderSessionToken).toBe('existing-session');
    expect(sessionStarts).toBe(1);
  });

  it('polls visible documents and refreshes immediately after returning from hidden',async()=>{
    const render=publicMenu(menu);
    await settle(render);
    payload.closures=[closure];
    await vi.advanceTimersByTimeAsync(30_000);
    expect(await settle(render)).toContain('Closure one');
    documentTarget.visibilityState='hidden';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    const requests=fetchMock.mock.calls.length;
    payload.closures=[];
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetchMock.mock.calls.length).toBe(requests);
    documentTarget.visibilityState='visible';
    documentTarget.dispatchEvent(new Event('visibilitychange'));
    expect(await settle(render)).not.toContain('public-menu-special-closure');
  });

  it('keeps an initially closed QR blocked after a failed or malformed refresh',async()=>{
    payload.closures=[closure];
    const render=qr({...menu,orderingOpenNow:false,specialClosure:closure});
    await settle(render);
    for(const response of [new Response(null,{status:503}),Response.json({timezone:'Asia/Taipei'}),
      Response.json({timezone:'Invalid/Zone',closures:[]}),
      Response.json({timezone:'Asia/Taipei',closures:[{...closure,startsOn:'2026-99-27'}]})]) {
      fetchMock.mockResolvedValueOnce(response);
      const result=await refresh(render);
      expect(result.session?.specialClosure?.isActive).toBe(true);
      expect(result.orderingEnabled).toBe(false);
      expect(sessionStarts).toBe(0);
    }
  });

  it('queues a fresh read when focus occurs during an older closure response',async()=>{
    payload.closures=[closure];
    const render=publicMenu({...menu,specialClosure:closure});
    await settle(render);
    let finish!: (response:Response)=>void;
    fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
    windowTarget.dispatchEvent(new Event('focus'));
    payload.closures=[];
    windowTarget.dispatchEvent(new Event('focus'));
    windowTarget.dispatchEvent(new Event('focus'));
    finish(Response.json({timezone:'Asia/Taipei',closures:[closure]}));
    expect(await settle(render)).not.toContain('public-menu-special-closure');
    expect(fetchMock.mock.calls.length).toBe(3);
  });

  it('aborts on unmount and ignores a late response and subsequent focus',async()=>{
    const render=qr({...menu,specialClosure:closure,orderingOpenNow:false});
    payload.closures=[closure];
    await settle(render);
    let finish!: (response:Response)=>void;
    fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
    windowTarget.dispatchEvent(new Event('focus'));
    windowTarget.dispatchEvent(new Event('focus'));
    const signal=fetchMock.mock.calls.at(-1)![1]?.signal as AbortSignal;
    shared.runtime.stop();
    finish(Response.json({timezone:'Asia/Taipei',closures:[]}));
    await Promise.resolve();await Promise.resolve();await Promise.resolve();
    windowTarget.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(signal.aborted).toBe(true);
    expect(fetchMock.mock.calls.length).toBe(2);
    expect(sessionStarts).toBe(0);
  });

  it('does not reopen after an aborted request eventually returns stale empty data',async()=>{
    payload.closures=[closure];
    const render=qr({...menu,specialClosure:closure,orderingOpenNow:false});
    await settle(render);
    let finish!: (response:Response)=>void;
    fetchMock.mockImplementationOnce(()=>new Promise<Response>(resolve=>{finish=resolve;}));
    windowTarget.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(8_000);
    finish(Response.json({timezone:'Asia/Taipei',closures:[]}));
    expect((await settle(render)).orderingEnabled).toBe(false);
    expect(sessionStarts).toBe(0);
  });

  it('keeps an upcoming notice nonblocking and observes the partial-day opening boundary',async()=>{
    const tomorrow={...closure,startsOn:'2026-10-28',endsOn:'2026-10-28'};
    payload.closures=[tomorrow];
    const render=qr(menu);
    let result=await settle(render);
    expect(result.session?.specialClosure?.title).toBe('Closure one');
    expect(result.session?.specialClosure?.isActive).toBe(false);
    expect(result.orderingEnabled).toBe(true);
    payload.closures=[{...closure,opensAt:'14:00',closesAt:'16:00'}];
    result=await refresh(render);
    expect(result.orderingEnabled).toBe(false);
    vi.setSystemTime(new Date('2026-10-27T06:00:00Z'));
    result=await refresh(render);
    expect(result.orderingEnabled).toBe(true);
    expect(sessionStarts).toBe(1);
  });

  it('keeps fresh closure state authoritative over a late session snapshot',async()=>{
    let finish!: (response:Response)=>void;
    shared.request.mockImplementationOnce(()=>{sessionStarts++;return new Promise<Response>(resolve=>{finish=resolve;});});
    const render=qr(menu);
    await settle(render);
    payload.closures=[closure];
    await refresh(render);
    finish(Response.json({...menu,orderSessionToken:'existing-session',expiresAt:'2026-10-27T06:00:00Z'}));
    const result=await settle(render);
    expect(result.session?.specialClosure?.isActive).toBe(true);
    expect(result.orderingEnabled).toBe(false);
    expect(sessionStarts).toBe(1);
  });
});
