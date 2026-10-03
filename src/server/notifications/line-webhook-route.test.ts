import {createHmac} from 'node:crypto';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({integration:{id:'ecc59195-8cb2-4c18-a2cf-1aaedda630d2',organizationId:'ac51b9d8-053c-46c9-bdfa-4f16002e4789',stallId:'ed7d7b6d-2b3d-4925-818c-a07caefcf66b',provider:'LINE',status:'ACTIVE',secretReference:'b2b21dd4-c830-46dc-813d-40e0d315df11',publicIdentifier:'1111111111',settingsJson:{displayName:'SIMULATED',notifyConfirmed:true,notifyReady:true,notifyCancelled:true,webhookManagement:{version:0,localMock:true,messagingChannelId:'2222222222',senderPolicy:'MERCHANT_OA'}}},events:vi.fn()}));
vi.mock('@/lib/prisma',()=>({prisma:{notificationIntegration:{findFirst:vi.fn(async()=>state.integration)},$queryRaw:vi.fn(async()=>[{sender_scope:'LEGACY',environment:'local',provider_id:'3333333333',oa_destination:'UtrustedMessagingDestination'}]),lineWebhookEvent:{create:state.events}}}));
vi.mock('@/lib/rate-limit',()=>({checkPublicRateLimit:vi.fn(async()=>({allowed:true}))}));
vi.mock('@/lib/audit',()=>({logEvent:vi.fn(),recordAuditEvent:vi.fn()}));
vi.mock('@/server/notifications/notification-secrets',()=>({readNotificationSecret:vi.fn(async()=>JSON.stringify({channelAccessToken:'SIMULATED-access-token',messagingChannelSecret:'SIMULATED-messaging-secret',loginChannelSecret:'SIMULATED-login-secret'})),deleteNotificationSecret:vi.fn()}));
import {POST} from '../../app/api/webhooks/line/[integrationId]/route';
beforeEach(()=>{vi.clearAllMocks();vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));});
describe('legacy webhook trusted Messaging destination',()=>{
 it('rejects a signed request addressed to a different Messaging destination',async()=>{
  const body=JSON.stringify({destination:'UotherMessagingDestination',events:[]});
  const signature=createHmac('sha256','SIMULATED-messaging-secret').update(body).digest('base64');
  const request=new Request('http://127.0.0.1:3026/api/webhooks/line/'+state.integration.id,{method:'POST',headers:{'content-type':'application/json','x-line-signature':signature},body});
  const response=await POST(request,{params:Promise.resolve({integrationId:state.integration.id})});
  expect(response.status).toBe(403);expect(state.events).not.toHaveBeenCalled();
 });
});

it('rejects changed original bytes even when UTF-8 replacement yields the signed text',async()=>{
 const body=JSON.stringify({destination:'UtrustedMessagingDestination',events:[],note:'\ufffd'});
 const wire=Uint8Array.from(Buffer.from(body.replace('\ufffd','?')));wire[wire.indexOf(63)]=255;
 const signature=createHmac('sha256','SIMULATED-messaging-secret').update(body).digest('base64');
 const request=new Request('http://127.0.0.1:3026/api/webhooks/line/'+state.integration.id,{method:'POST',headers:{'content-type':'application/json','x-line-signature':signature},body:wire});
 const response=await POST(request,{params:Promise.resolve({integrationId:state.integration.id})});
 expect(response.status).toBe(401);expect(state.events).not.toHaveBeenCalled();
});
