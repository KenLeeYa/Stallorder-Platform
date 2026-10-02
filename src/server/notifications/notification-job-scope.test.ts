import { beforeEach,describe,expect,it,vi } from "vitest";
const state=vi.hoisted(()=>({writes:[] as {sql:string;values:unknown[]}[],selected:false}));
const secret=vi.hoisted(()=>vi.fn());
const id="11111111-1111-4111-8111-111111111111";
vi.mock("@/lib/prisma",()=>{
 const db={
  $queryRaw:vi.fn(async(strings:any,...values:unknown[])=>{const sql=Array.isArray(strings)?strings.join('?'):strings.sql;
   if(sql.includes('order by created_at limit 50'))return[];
   if(sql.includes('select id::text from public.notification_jobs')){state.selected=true;return[{id:'11111111-1111-4111-8111-111111111111'}];}
   if(sql.includes('select * from public.notification_jobs'))return[{id:'11111111-1111-4111-8111-111111111111',legacy_intent_json:{version:1,purpose:'COMMERCE',organizationId:id,stallId:id,orderId:id,integrationId:id,contactLinkId:id,recipientReference:id,recipientHash:'synthetic',providerId:null,environment:null,destination:null,secretRevision:null,loginChannelId:null,messagingChannelId:null,policy:'MERCHANT_OA',notifyConfirmed:true,notifyReady:true,notifyCancelled:true,templateVersion:1},order_id:id,organization_id:id,stall_id:id,integration_id:id,contact_link_id:id}];
   if(sql.includes('line_platform_order_owners')){expect(state.selected).toBe(true);return[{order_id:id}];}
   if(sql.includes('billing_feature_flags'))return[{code:'OPEN_BETA_FREE_ACCESS_ENABLED'}];
   return[];
  }),
  $executeRaw:vi.fn(async(strings:TemplateStringsArray,...values:unknown[])=>{state.writes.push({sql:strings.join('?'),values});return 1;}),
  notificationIntegration:{findUniqueOrThrow:vi.fn(async()=>({settingsJson:{}}))},customerContactLink:{findUniqueOrThrow:vi.fn(async()=>({}))},order:{findUniqueOrThrow:vi.fn(async()=>({}))}
 };return{prisma:{...db,$transaction:vi.fn(async callback=>callback(db))}};
});
vi.mock("./notification-secrets",()=>({readNotificationSecret:secret}));
import {processDueNotificationJobs} from "./notification-job-processor";
beforeEach(()=>{vi.clearAllMocks();state.writes=[];state.selected=false;vi.stubGlobal('fetch',vi.fn(()=>{throw Error('NETWORK_FORBIDDEN');}));});
describe("legacy notification isolation after platform cutover",()=>{
 it("pauses a legacy job if the order acquired a platform owner after candidate selection",async()=>{
  expect(await processDueNotificationJobs()).toEqual([{jobId:id,status:'PAUSED',sender:'NONE',reason:'PLATFORM_ORDER_LEGACY_BLOCKED'}]);
  expect(secret).not.toHaveBeenCalled();expect(fetch).not.toHaveBeenCalled();expect(state.writes).toHaveLength(2);
  expect(state.writes.every(write=>write.sql.includes('update public.notification_jobs')&&!write.sql.includes('line_platform_order_owners')&&write.values.includes(id))).toBe(true);
  const pause=state.writes[1];expect(pause.sql).toContain("outcome='SUPPRESSED'");expect(pause.sql).toContain("delivery_mode='LEGACY'");expect(pause.sql).toContain('lease_token=?::uuid');expect(pause.sql).toContain('lease_expires_at>clock_timestamp()');expect(pause.values).toContain('PLATFORM_ORDER_LEGACY_BLOCKED');
 });
});
