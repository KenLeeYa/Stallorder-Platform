import {beforeEach,expect,it,vi} from 'vitest';
const state=vi.hoisted(()=>({settings:{} as any,calls:[] as {method:string;url:string;body:any}[],revision:'r1',endpoint:'',active:false,secretReads:0}));
const ids=vi.hoisted(()=>({integration:'73333333-3333-4333-8333-333333333333',organization:'71111111-1111-4111-8111-111111111111',stall:'72222222-2222-4222-8222-222222222222',actor:'74444444-4444-4444-8444-444444444444'}));
vi.mock('@/lib/prisma',()=>{const db={$queryRaw:vi.fn(async()=>[{id:ids.integration,organization_id:ids.organization,stall_id:ids.stall,stall_name:'SIMULATED',status:'ACTIVE',environment:'local',provider_id:'9990001',oa_destination:'USIMULATED',secret_reference:'75555555-5555-4555-8555-555555555555',settings_json:state.settings}]),$executeRaw:vi.fn(async(_strings,...values)=>{state.settings=JSON.parse(values[0]);return 1;})};return{prisma:{...db,$transaction:vi.fn(async callback=>callback(db))}};});
vi.mock('@/server/notifications/notification-secrets',()=>({readNotificationSecret:vi.fn(async()=>{state.secretReads++;return JSON.stringify({channelAccessToken:'SIMULATED-ACCESS-TOKEN',messagingChannelSecret:'SIMULATED-MESSAGING-SECRET',loginChannelSecret:'SIMULATED-LOGIN-SECRET'});})}));
vi.mock('@/server/notifications/line-messaging-provider',()=>({getLegacyLineMockTransport:vi.fn(()=>async(url:string,init:{method:string;body?:string;headers:Record<string,string>})=>{
 state.calls.push({url,method:init.method,body:init.body?JSON.parse(init.body):null});
 if(init.method==='POST')return Response.json({success:true});
 if(init.method==='PUT'){expect(init.headers['if-match']).toBe(state.revision);state.endpoint=JSON.parse(init.body!).endpoint;state.revision='r2';return Response.json({});}
 return Response.json({endpoint:state.endpoint,active:state.active,revision:state.revision,providerId:'9990001',messagingChannelId:'9990004',destination:'USIMULATED'});
})}));
import {lineWebhookManagementCommandSchema} from '@/lib/line-webhook-management-contract';
import {listLegacyWebhookManagement,readLegacyWebhookManagement,manageLegacyWebhook,validateLegacyWebhookCallback} from './line-webhook-management';
beforeEach(()=>{state.settings={displayName:'SIMULATED',notifyConfirmed:true,notifyReady:true,notifyCancelled:true,webhookManagement:{version:0,localMock:true,messagingChannelId:'9990004',senderPolicy:'MERCHANT_OA'}};state.calls=[];state.endpoint='';state.revision='r1';state.active=false;state.secretReads=0;process.env.NEXT_PUBLIC_APP_URL='https://example.test';vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));});
it('binds admin commands with an opaque server-issued channel binding instead of exposing the channel identifier',()=>{
 const target={organizationId:'71111111-1111-4111-8111-111111111111',stallId:'72222222-2222-4222-8222-222222222222',integrationId:'73333333-3333-4333-8333-333333333333',environment:'local',expectedVersion:0,operation:'TEST',callbackUrl:'https://example.test/api/webhooks/line/73333333-3333-4333-8333-333333333333',senderPolicy:'MERCHANT_OA'};
 expect(lineWebhookManagementCommandSchema.safeParse({...target,channelBinding:'a'.repeat(64)}).success).toBe(true);
 expect(lineWebhookManagementCommandSchema.safeParse({...target,messagingChannelId:'9990004'}).success).toBe(false);
});
it('rejects arbitrary or non-canonical callbacks without fetching them',()=>{
 const path='/api/webhooks/line/'+ids.integration;
 expect(validateLegacyWebhookCallback('https://example.test'+path,ids.integration)).toBe('https://example.test'+path);
 for(const value of ['http://example.test'+path,'https://user:password@example.test'+path,'https://example.test:444'+path,'https://example.test'+path+'?x=1','https://example.test'+path+'#x','https://127.0.0.1'+path,'https://169.254.169.254'+path,'https://[::1]'+path,'https://example.test.evil.test'+path,'https://example.test/api/webhooks/line/%37'+ids.integration.slice(1),'https://example.test'+path+'/../'+ids.integration])expect(()=>validateLegacyWebhookCallback(value,ids.integration)).toThrow();
 expect(state.calls).toEqual([]);expect(state.secretReads).toBe(0);
});
it('returns masked binding, records tested diff, requires explicit apply, and reads back inactive Mock settings',async()=>{
 const listed=await listLegacyWebhookManagement();const target=listed.integrations[0] as any;
 expect(JSON.stringify(listed)).not.toContain('9990004');expect(JSON.stringify(listed)).not.toContain('75555555-5555');expect(target.channelLabel).toBe('••••0004');
 const test={operation:'TEST' as const,organizationId:ids.organization,stallId:ids.stall,integrationId:ids.integration,environment:'local' as const,expectedVersion:0,channelBinding:target.channelBinding,callbackUrl:'https://example.test/api/webhooks/line/'+ids.integration,senderPolicy:'PLATFORM_OA' as const};
 const tested=await manageLegacyWebhook(test,ids.actor);expect(tested.state).toBe('TESTED');expect(state.calls.map(c=>c.method)).toEqual(['GET','POST']);expect(state.endpoint).toBe('');expect(state.settings.webhookManagement.senderPolicy).toBe('MERCHANT_OA');
 const apply={operation:'APPLY' as const,organizationId:ids.organization,stallId:ids.stall,integrationId:ids.integration,environment:'local' as const,expectedVersion:1,channelBinding:target.channelBinding,testedDigest:(tested as any).testedDigest};
 const callCount=state.calls.length;await expect(manageLegacyWebhook({...apply,testedDigest:'b'.repeat(64)},ids.actor)).rejects.toThrow('FRESH_TEST_REQUIRED');await expect(manageLegacyWebhook(apply,'76666666-6666-4666-8666-666666666666')).rejects.toThrow('FRESH_TEST_REQUIRED');expect(state.calls).toHaveLength(callCount);
 const applied=await manageLegacyWebhook(apply,ids.actor);expect(applied.state).toBe('APPLIED');expect((applied as any).remoteActive).toBe(false);expect(state.calls.map(c=>c.method)).toEqual(['GET','POST','GET','PUT','GET']);expect(state.settings.webhookManagement).toMatchObject({version:3,senderPolicy:'PLATFORM_OA',callbackUrl:test.callbackUrl});expect(state.settings.webhookManagement.tested).toBeUndefined();
 await expect(manageLegacyWebhook(apply,ids.actor)).rejects.toThrow('TARGET_OR_VERSION_CHANGED');expect(state.calls.every(c=>c.url.startsWith('https://api.line.me/v2/bot/channel/webhook/'))).toBe(true);
});
it('rejects channel changes and active remote state before a provider mutation',async()=>{
 const target=(await listLegacyWebhookManagement()).integrations[0] as any;const command={operation:'TEST' as const,organizationId:ids.organization,stallId:ids.stall,integrationId:ids.integration,environment:'local' as const,expectedVersion:0,channelBinding:'b'.repeat(64),callbackUrl:'https://example.test/api/webhooks/line/'+ids.integration,senderPolicy:'MERCHANT_OA' as const};
 await expect(manageLegacyWebhook(command,ids.actor)).rejects.toThrow('TARGET_OR_VERSION_CHANGED');expect(state.secretReads).toBe(0);
 state.active=true;await expect(manageLegacyWebhook({...command,channelBinding:target.channelBinding},ids.actor)).rejects.toThrow();expect(state.calls.map(c=>c.method)).toEqual(['GET']);
});

it('masks noncanonical provider endpoints in read and tested diff without leaking credentials',async()=>{
 state.endpoint='https://SENSITIVE_USER:SENSITIVE_PASSWORD@example.test/path?SENSITIVE_QUERY=1';
 const read=await readLegacyWebhookManagement(ids.integration);expect(read).toMatchObject({state:'READ',remoteActive:false,status:'ACTIVE',localMockAvailable:true});expect(JSON.stringify(read)).not.toContain('SENSITIVE');
 const target=(await listLegacyWebhookManagement()).integrations[0] as any;
 const tested=await manageLegacyWebhook({operation:'TEST',organizationId:ids.organization,stallId:ids.stall,integrationId:ids.integration,environment:'local',expectedVersion:0,channelBinding:target.channelBinding,callbackUrl:'https://example.test/api/webhooks/line/'+ids.integration,senderPolicy:'MERCHANT_OA'},ids.actor);
 expect(JSON.stringify(tested)).not.toContain('SENSITIVE');expect(state.calls.map(c=>c.method)).toEqual(['GET','GET','POST']);
});
