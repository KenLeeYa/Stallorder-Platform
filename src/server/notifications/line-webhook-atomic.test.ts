import {createHmac} from 'node:crypto';
import {Prisma} from '@prisma/client';
import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({events:[] as string[],revoked:false,failDelete:true}));
const integration=vi.hoisted(()=>({id:'51111111-1111-4111-8111-111111111111',organizationId:'52222222-2222-4222-8222-222222222222',stallId:'53333333-3333-4333-8333-333333333333',secretReference:'54444444-4444-4444-8444-444444444444',settingsJson:{displayName:'SIMULATED',notifyConfirmed:true,notifyReady:true,notifyCancelled:true,webhookManagement:{version:0,localMock:true,messagingChannelId:'2222222222',senderPolicy:'MERCHANT_OA'}}}));
vi.mock('@/lib/rate-limit',()=>({checkPublicRateLimit:vi.fn(async()=>({allowed:true}))}));
vi.mock('@/lib/audit',()=>({logEvent:vi.fn(),recordAuditEvent:vi.fn()}));
vi.mock('@/server/notifications/notification-secrets',()=>({readNotificationSecret:vi.fn(async()=>JSON.stringify({channelAccessToken:'SIMULATED-access-token',messagingChannelSecret:'SIMULATED-messaging-secret',loginChannelSecret:'SIMULATED-login-secret'})),deleteNotificationSecret:vi.fn(async()=>{if(state.failDelete)throw Error('SIMULATED_TRANSACTION_FAILURE');})}));
vi.mock('@/lib/prisma',()=>{
 const binding=()=>({id:integration.id,organization_id:integration.organizationId,stall_id:integration.stallId,secret_reference:integration.secretReference,settings_json:integration.settingsJson,status:'ACTIVE',provider:'LINE',sender_scope:'LEGACY',provider_id:'3333333333',oa_destination:'UtrustedMessagingDestination'});
 function database(target:typeof state){return{
  notificationIntegration:{findFirst:vi.fn(async()=>integration)},$queryRaw:vi.fn(async()=>[binding()]),$executeRaw:vi.fn(async()=>0),
  lineWebhookEvent:{create:vi.fn(async({data})=>{if(target.events.includes(data.providerEventHash))throw new Prisma.PrismaClientKnownRequestError('duplicate',{code:'P2002',clientVersion:'test'});target.events.push(data.providerEventHash);return{id:data.providerEventHash};}),createMany:vi.fn(async({data})=>{const entries=Array.isArray(data)?data:[data];let count=0;for(const event of entries)if(!target.events.includes(event.providerEventHash)){target.events.push(event.providerEventHash);count++;}return{count};}),update:vi.fn()},
  customerContactLink:{findMany:vi.fn(async()=>target.revoked?[]:[{id:'55555555-5555-4555-8555-555555555555',providerUserSecretReference:'56666666-6666-4666-8666-666666666666'}]),updateMany:vi.fn(async()=>{target.revoked=true;return{count:1};})},notificationJob:{updateMany:vi.fn()},
 };}
 const db=database(state);return{prisma:{...db,$transaction:vi.fn(async callback=>{const staged={...state,events:[...state.events]};const result=await callback(database(staged));state.events=staged.events;state.revoked=staged.revoked;return result;})}};
});
import {POST} from '../../app/api/webhooks/line/[integrationId]/route';
beforeEach(()=>{vi.clearAllMocks();state.events=[];state.revoked=false;state.failDelete=true;vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));});
it('rolls back the replay receipt with failed revocation, then permits one successful retry and no duplicate effect',async()=>{
 const body=JSON.stringify({destination:'UtrustedMessagingDestination',events:[{type:'unfollow',timestamp:1,webhookEventId:'same-event',source:{type:'user',userId:'USIMULATED'}}]});
 const send=()=>POST(new Request('http://127.0.0.1:3026/api/webhooks/line/'+integration.id,{method:'POST',headers:{'content-type':'application/json','x-line-signature':createHmac('sha256','SIMULATED-messaging-secret').update(body).digest('base64')},body}),{params:Promise.resolve({integrationId:integration.id})});
 expect((await send()).status).toBe(500);expect(state.events).toEqual([]);expect(state.revoked).toBe(false);
 state.failDelete=false;expect((await send()).status).toBe(200);expect(state.events).toHaveLength(1);expect(state.revoked).toBe(true);
 expect((await send()).status).toBe(200);expect(state.events).toHaveLength(1);
});
