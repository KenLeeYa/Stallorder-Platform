import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({authorized:true,csrf:true,calls:0,fail:false}));
vi.mock('@/lib/authorization',()=>({authorizePlatformAdminApiRequest:vi.fn(async()=>state.authorized?{ok:true,principal:{user:{id:'81111111-1111-4111-8111-111111111111'}},requestId:'SIMULATED'}:{ok:false,response:Response.json({error:'UNAUTHENTICATED'},{status:401})})}));
vi.mock('@/lib/csrf',()=>({validateCsrf:vi.fn(()=>state.csrf)}));
vi.mock('@/lib/http',()=>({readJson:vi.fn(async(request:Request)=>({data:await request.json()}))}));
vi.mock('@/server/notifications/line-webhook-management',()=>({readLegacyWebhookManagement:vi.fn(async()=>{state.calls++;return{state:'READ',mode:'SIMULATED'};}),listLegacyWebhookManagement:vi.fn(async()=>{state.calls++;return{enabled:false,integrations:[]};}),manageLegacyWebhook:vi.fn(async()=>{state.calls++;if(state.fail)throw Error('SIMULATED-SECRET-MUST-NOT-LEAK');return{state:'TESTED',mode:'SIMULATED'};})}));
import {GET,POST} from '../../app/api/admin/line-platform/webhooks/route';
const body={operation:'TEST',organizationId:'82222222-2222-4222-8222-222222222222',stallId:'83333333-3333-4333-8333-333333333333',integrationId:'84444444-4444-4444-8444-444444444444',channelBinding:'a'.repeat(64),environment:'local',expectedVersion:0,callbackUrl:'https://example.test/api/webhooks/line/84444444-4444-4444-8444-444444444444',senderPolicy:'MERCHANT_OA'};
const request=(input:unknown=body)=>new Request('http://127.0.0.1:3026/api/admin/line-platform/webhooks',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
beforeEach(()=>{state.authorized=true;state.csrf=true;state.calls=0;state.fail=false;vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));});
it('authorizes reads and writes before entering management',async()=>{state.authorized=false;expect((await GET(request())).status).toBe(401);expect((await POST(request())).status).toBe(401);expect(state.calls).toBe(0);});
it('requires CSRF and the literal local environment before any management effect',async()=>{state.csrf=false;expect((await POST(request())).status).toBe(403);state.csrf=true;expect((await POST(request({...body,environment:'production'}))).status).toBe(400);expect(state.calls).toBe(0);});
it('rejects caller-added credentials and arbitrary command fields',async()=>{expect((await POST(request({...body,channelAccessToken:'SIMULATED'}))).status).toBe(400);expect(state.calls).toBe(0);});
it('returns sanitized failures and no-store responses',async()=>{state.fail=true;const response=await POST(request());expect(response.status).toBe(409);expect(response.headers.get('cache-control')).toBe('no-store');expect(await response.text()).not.toContain('SIMULATED-SECRET');});

it('reads the selected current Mock binding explicitly before testing or applying',async()=>{const response=await GET(new Request('http://127.0.0.1:3026/api/admin/line-platform/webhooks?integrationId='+body.integrationId));expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'READ',mode:'SIMULATED'});expect(state.calls).toBe(1);});
