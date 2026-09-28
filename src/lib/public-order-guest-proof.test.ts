import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
const trackingToken=`sto_${'a'.repeat(43)}`;
const payload={orderSessionToken:`stos_${'b'.repeat(43)}`,deviceId:'11111111-1111-4111-8111-111111111111'};
beforeEach(()=>{
  vi.stubEnv('NODE_ENV','test');vi.stubEnv('NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL','https://synthetic.supabase.co/functions/v1');
  vi.stubEnv('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY','public-synthetic');
  vi.stubGlobal('window',{location:{pathname:'/store/synthetic',hostname:'app.synthetic.test'}});
});
afterEach(()=>{vi.unstubAllEnvs();vi.unstubAllGlobals();vi.resetModules();});
describe('guest proof exchange after successful Circuit A intake',()=>{
  function transport(proof:()=>Promise<Response>=async()=>Response.json({ok:true})) {
    return vi.fn<typeof fetch>(async url=>{
      if(String(url)==='/api/availability/config') return Response.json({orderIntake:'EDGE_PRIMARY'});
      if(String(url).endsWith('/create-public-order')) return Response.json({trackingToken},{status:201});
      if(String(url)==='/api/public/orders/claim-proof') return proof();
      if(String(url)==='/api/mini/orders') return Response.json({trackingToken},{status:201});
      throw new Error('Unexpected synthetic request');
    });
  }
  it('exchanges the already validated session for a same-origin cookie without submitting another order',async()=>{
    const fetchImpl=transport();const {requestPublicOrder}=await import('./public-order-client');
    const response=await requestPublicOrder('create-public-order',payload,{fetchImpl});
    expect(response.status).toBe(201);expect(await response.json()).toEqual({trackingToken});
    const calls=fetchImpl.mock.calls.filter(([url])=>String(url)==='/api/public/orders/claim-proof');
    expect(calls).toHaveLength(1);expect(JSON.parse(String(calls[0][1]?.body))).toEqual({...payload,trackingToken});
    expect(calls[0][1]?.credentials).toBe('same-origin');expect(calls[0][1]?.signal).toBeInstanceOf(AbortSignal);
    expect(fetchImpl.mock.calls.filter(([url])=>String(url).endsWith('/create-public-order'))).toHaveLength(1);
  });
  it('preserves the committed success when the optional exchange fails',async()=>{
    const fetchImpl=transport(async()=>{throw new TypeError('Synthetic unavailable');});
    const {requestPublicOrder}=await import('./public-order-client');
    const response=await requestPublicOrder('create-public-order',payload,{fetchImpl});
    expect(response.status).toBe(201);expect(await response.json()).toEqual({trackingToken});
    expect(fetchImpl.mock.calls.some(([url])=>String(url)==='/api/public/orders')).toBe(false);
  });
  it('does not exchange a proof for MINI direct orders',async()=>{
    vi.stubGlobal('window',{location:{pathname:'/mini/store/synthetic',hostname:'app.synthetic.test'}});
    const fetchImpl=transport();const {requestPublicOrder}=await import('./public-order-client');
    expect((await requestPublicOrder('create-public-order',payload,{fetchImpl})).status).toBe(201);
    expect(fetchImpl.mock.calls).toHaveLength(1);expect(fetchImpl.mock.calls[0][0]).toBe('/api/mini/orders');
  });
});
