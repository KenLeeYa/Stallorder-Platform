import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({authorized:true,csrf:true,queries:[] as string[],writes:0}));
const job=vi.hoisted(()=>({id:'61111111-1111-4111-8111-111111111111',organization_id:'62222222-2222-4222-8222-222222222222',stall_id:'63333333-3333-4333-8333-333333333333',order_id:'64444444-4444-4444-8444-444444444444',template_code:'ORDER_CONFIRMED',outcome:'MANUAL_REVIEW',attempt_count:5,last_error_code:'LEGACY_DELIVERY_OUTCOME_UNKNOWN',sent_at:null,next_attempt_at:null,stall_name:'SIMULATED'}));
vi.mock('@/lib/authorization',()=>({authorizePlatformAdminApiRequest:vi.fn(async()=>state.authorized?{ok:true,principal:{user:{id:'65555555-5555-4555-8555-555555555555'}},requestId:'simulated'}:{ok:false,response:Response.json({error:'UNAUTHENTICATED'},{status:401})})}));
vi.mock('@/lib/csrf',()=>({validateCsrf:vi.fn(()=>state.csrf)}));
vi.mock('@/lib/http',()=>({readJson:vi.fn(async(request:Request)=>({data:await request.json()}))}));
vi.mock('@/server/line-platform/runtime',()=>({getLinePlatformRuntime:vi.fn(()=>null)}));
vi.mock('@/server/line-platform/notification-binding',()=>({ensurePlatformNotificationIntegration:vi.fn(()=>{throw Error('PLATFORM_MUTATION_FORBIDDEN');})}));
vi.mock('@/server/line-platform/notification-worker',()=>({retryPlatformNotification:vi.fn(()=>{throw Error('PLATFORM_RETRY_FORBIDDEN');})}));
vi.mock('@/lib/prisma',()=>({prisma:{$queryRaw:vi.fn(async(strings:TemplateStringsArray)=>{state.queries.push(strings.join('?'));return[job];}),$executeRaw:vi.fn(()=>{state.writes++;throw Error('STATE_WRITE_FORBIDDEN');})}}));
import {GET,POST} from '../../app/api/admin/line-platform/notifications/route';
beforeEach(()=>{vi.clearAllMocks();state.authorized=true;state.csrf=true;state.queries=[];state.writes=0;vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));});
it('exposes legacy terminal jobs independently of disabled platform runtime',async()=>{
 const response=await GET(new Request('http://127.0.0.1:3026/api/admin/line-platform/notifications?mode=LEGACY'));
 expect(response.status).toBe(200);const data=await response.json();expect(data.jobs).toEqual([job]);expect(data.mode).toBe('LEGACY');expect(state.queries.every(sql=>sql.includes("delivery_mode='LEGACY'"))).toBe(true);expect(state.writes).toBe(0);
});
it('keeps unknown outcome unchanged and requests trustworthy reconciliation evidence',async()=>{
 const response=await POST(new Request('http://127.0.0.1:3026/api/admin/line-platform/notifications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({operation:'RECONCILE_LEGACY',jobId:job.id,organizationId:job.organization_id,stallId:job.stall_id})}));
 expect(response.status).toBe(200);expect(await response.json()).toMatchObject({state:'EVIDENCE_REQUIRED',outcome:'MANUAL_REVIEW',resent:false});expect(state.writes).toBe(0);
});
