import {beforeEach,expect,it,vi} from "vitest";
import {isValidElement,type ReactElement} from "react";
import {mobileOrderStatusSchema,type MobileOrderListResponse} from "@stallorder/contracts/mobile/v1";
import {operationsKey} from "@stallorder/contracts/operations/v1/query-key";
import OrdersScreen from "../../app/orders";
import {orders} from "../api/client";

type QueryOptions={queryKey:readonly unknown[];enabled:boolean;queryFn:(input:{pageParam?:string;signal:AbortSignal})=>Promise<MobileOrderListResponse>};
const h=vi.hoisted(()=>({states:[] as unknown[],cursor:0,options:null as QueryOptions|null,permissions:["VIEW_ORDERS"],pages:[] as MobileOrderListResponse[],urls:[] as URL[],findMany:vi.fn(),authorize:vi.fn()}));
const stallId="11111111-1111-4111-8111-111111111111",organizationId="22222222-2222-4222-8222-222222222222";
const scope={version:"v1" as const,environment:"local" as const,principalKey:"a".repeat(64),sessionEpoch:"b".repeat(64),permissionRevision:"c".repeat(64),context:{kind:"organization" as const,organizationId,stallIds:[stallId]}};
vi.mock("react",async()=>({...await vi.importActual<typeof import("react")>("react"),useState:(initial:unknown)=>{const index=h.cursor++;if(!(index in h.states))h.states[index]=initial;return[h.states[index],(value:unknown)=>{h.states[index]=value;}];}}));
vi.mock("react-native",()=>({ActivityIndicator:"ActivityIndicator",Pressable:"Pressable",Text:"Text",TextInput:"TextInput",View:"View",StyleSheet:{create:(v:unknown)=>v}}));
vi.mock("react-native-safe-area-context",()=>({SafeAreaView:"SafeAreaView"}));
vi.mock("@shopify/flash-list",()=>({FlashList:"FlashList"}));
vi.mock("expo-router",()=>({Redirect:"Redirect",router:{back:vi.fn(),push:vi.fn()},useLocalSearchParams:()=>({stallId:"11111111-1111-4111-8111-111111111111"})}));
vi.mock("@tanstack/react-query",()=>({useQueryClient:()=>({}),useInfiniteQuery:(options:QueryOptions)=>{h.options=options;return{data:{pages:h.pages},isPending:false};}}));
vi.mock("../auth/session-context",()=>({useSession:()=>({bootstrapData:{workspaces:[{id:organizationId,defaultCurrency:"TWD",stalls:[{id:stallId,name:"測試攤位",permissions:h.permissions}]}]},runAuthenticated:(fn:(token:string,device:string)=>unknown)=>fn("synthetic-token","33333333-3333-4333-8333-333333333333")})}));
vi.mock("./query",()=>({useNativeScope:()=>({data:scope}),useReadCadence:()=>15000,nativeRead:(_client:unknown,_key:unknown,_signal:unknown,read:()=>unknown)=>read()}));
vi.mock("@/lib/prisma",()=>({prisma:{order:{findMany:h.findMany}}}));
vi.mock("@/server/mobile/authorization",()=>({authorizeMobileStallRequest:h.authorize}));

// Resolve the real Web BFF at test time without adding server imports to the Native type graph.
const routePath="../../../../src/app/api/mobile/v1/stalls/[stallId]/orders/route.ts";
let route:(request:Request,context:{params:Promise<{stallId:string}>})=>Promise<Response>;
const time=new Date("2026-10-02T00:00:00.000Z");
const records=Array.from({length:501},(_,i)=>({id:`00000000-0000-4000-8000-${String(i+1).padStart(12,"0")}`,orderNo:`ORDER-${i+1}`,status:i%2?"CANCELLED":"COMPLETED",paymentStatus:"PAID",fulfillmentType:"TAKEOUT",customerName:"合成訂單",tableLabel:null,total:100,isTest:true,createdAt:time,updatedAt:time,_count:{items:1}})).reverse();
function render(){h.cursor=0;return OrdersScreen() as ReactElement<Record<string,unknown>>;}
function elements(node:unknown):ReactElement<Record<string,unknown>>[]{if(Array.isArray(node))return node.flatMap(elements);if(!isValidElement(node))return[];const element=node as ReactElement<Record<string,unknown>>;return[element,...Object.values(element.props).flatMap(elements)];}
function choose(label:string){const tab=elements(render()).find(e=>e.props.accessibilityRole==="tab"&&JSON.stringify(e.props.children).includes(label));expect(tab).toBeDefined();(tab!.props.onPress as ()=>void)();render();}
beforeEach(async()=>{
 vi.clearAllMocks();h.states=[];h.cursor=0;h.pages=[];h.urls=[];h.permissions=["VIEW_ORDERS"];
 route=(await import(routePath)).GET;
 h.authorize.mockResolvedValue({ok:true,requestId:"synthetic-request",stall:{id:stallId}});
 h.findMany.mockImplementation(async({where,take}:{where:{stallId:string;status:{in:string[]};AND?:{OR:{id?:{lt:string}}[]}[]};take:number})=>{expect(where.stallId).toBe(stallId);const cursor=where.AND?.flatMap(x=>x.OR).find(x=>x.id)?.id?.lt;return records.filter(r=>where.status.in.includes(r.status)&&(!cursor||r.id<cursor)).slice(0,take);});
 vi.stubGlobal("fetch",vi.fn(async(input:RequestInfo|URL,init?:RequestInit)=>{const url=new URL(String(input));h.urls.push(url);expect(init?.credentials).toBe("omit");expect(new Headers(init?.headers).get("authorization")).toBe("Bearer synthetic-token");return route(new Request(url,init),{params:Promise.resolve({stallId})});}));
});

it("全部 consumer pages through all 501 completed/cancelled orders with canonical statuses and the same scoped key",async()=>{
 render();let cursor:string|undefined;const received:string[]=[];
 do{const page=await h.options!.queryFn({pageParam:cursor,signal:new AbortController().signal});h.pages.push(page);received.push(...page.orders.map(r=>r.id));cursor=page.nextCursor??undefined;expect(h.pages.length).toBeLessThanOrEqual(11);}while(cursor);
 expect(received).toEqual(records.map(r=>r.id));expect(new Set(received).size).toBe(501);
 expect(h.pages.map(p=>p.orders.length)).toEqual([...Array(10).fill(50),1]);
 for(const url of h.urls){expect(url.searchParams.getAll("status")).toEqual(mobileOrderStatusSchema.options);expect([...new Set(url.searchParams.keys())].sort()).toEqual(url.searchParams.has("cursor")?["cursor","limit","status"]:["limit","status"]);}
 expect(h.options!.queryKey).toEqual(operationsKey(scope,"native-orders",{stallId,query:"",statuses:mobileOrderStatusSchema.options}));
 expect(h.authorize).toHaveBeenCalledTimes(11);for(const args of h.authorize.mock.calls)expect(args.slice(1)).toEqual([stallId,"VIEW_ORDERS"]);
 const tree=render();const list=elements(tree).find(e=>e.type as unknown==="FlashList")!;expect((list.props.data as unknown[]).length).toBe(501);
});

it("keeps completed/active filters distinct and preserves the API absent-status active fallback",async()=>{
 choose("已完成");const completed=await h.options!.queryFn({signal:new AbortController().signal});expect(completed.orders).toHaveLength(50);expect(h.urls.at(-1)!.searchParams.getAll("status")).toEqual(["COMPLETED"]);
 choose("進行中");expect((await h.options!.queryFn({signal:new AbortController().signal})).orders).toEqual([]);expect(h.urls.at(-1)!.searchParams.getAll("status")).toEqual(["WAITING_CONFIRMATION","CONFIRMED","PREPARING","PACKING","READY"]);
 const defaultPage=await orders("synthetic-token","33333333-3333-4333-8333-333333333333",stallId);expect(defaultPage.orders).toEqual([]);expect(h.urls.at(-1)!.searchParams.has("status")).toBe(false);
});

it("does not enable the broader status filter without the current VIEW_ORDERS grant",()=>{
 h.permissions=[];expect(JSON.stringify(render())).toContain("無法存取此攤位訂單");expect(h.options!.enabled).toBe(false);expect(h.findMany).not.toHaveBeenCalled();expect(h.urls).toEqual([]);
});
