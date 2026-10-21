import { beforeEach,describe,expect,it,vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
const m=vi.hoisted(()=>({runtime:vi.fn(),principal:vi.fn(),owner:vi.fn(),order:vi.fn(),query:vi.fn(),event:vi.fn()}));
vi.mock("next/navigation",()=>({notFound:()=>{throw new Error("NOT_FOUND");}}));
vi.mock("next/link",()=>({default:({children,href}:{children:React.ReactNode;href:string})=><a href={href}>{children}</a>}));
vi.mock("@/lib/auth",()=>({getPagePrincipal:m.principal}));
vi.mock("@/lib/prisma",()=>({prisma:{order:{findUnique:m.order},orderEvent:{findFirst:m.event},$queryRaw:m.query}}));
vi.mock("@/server/line-platform/runtime",()=>({getLinePlatformRuntime:m.runtime}));
vi.mock("@/server/line-platform/member-service",()=>({requirePlatformOrderOwner:m.owner}));
vi.mock("@/components/line-platform-pay-button",()=>({LinePlatformPayButton:({allowNewPayment}:{allowNewPayment:boolean})=><div>付款狀態可查・新付款{allowNewPayment?"開放":"停用"}</div>}));
vi.mock("@/components/line-platform-pickup-card",()=>({LinePlatformPickupCard:()=> <div>取餐憑證可查</div>}));
vi.mock("@/components/line-platform-order-refresh",()=>({LinePlatformOrderRefresh:()=>null}));
vi.mock("@/components/line-miniapp-login",()=>({LineMiniAppLogin:()=> <div>需 LINE 登入</div>}));
import Page from "./page";
const id="11111111-1111-4111-8111-111111111111";
const render=async()=>renderToStaticMarkup(await Page({params:Promise.resolve({orderId:id})}));
describe("MINI order stop switches preserve inflight recovery",()=>{
  beforeEach(()=>{
    vi.clearAllMocks();m.runtime.mockReturnValue({payEnabled:false,pickupEnabled:false});m.principal.mockResolvedValue({user:{id}});
    m.owner.mockResolvedValue({profile_id:id});m.query.mockResolvedValue([{has_payment:true,pickup_required:true}]);m.event.mockResolvedValue(null);
    m.order.mockResolvedValue({id,organizationId:"org-a",stallId:"stall-a",orderNo:"TEST-1",status:"READY",paymentStatus:"UNPAID",total:100,updatedAt:new Date(),items:[],stall:{name:"合成測試店",code:"public-code",slug:"operator-slug",location:"測試"}});
  });
  it("keeps existing payment recovery and required pickup when new-capability flags are off",async()=>{
    const html=await render();expect(html).toContain("付款狀態可查・新付款停用");expect(html).toContain("取餐憑證可查");
    expect(html).toContain('/mini/store/public-code?view=menu');expect(html).not.toContain('/mini/store/operator-slug');
  });
  it("does not expose new capabilities on unmanaged existing orders",async()=>{
    m.query.mockResolvedValue([{has_payment:false,pickup_required:false}]);const html=await render();
    expect(html).not.toContain("付款狀態可查");expect(html).not.toContain("取餐憑證可查");
  });
  it("never offers a new payment for an already paid order",async()=>{
    m.runtime.mockReturnValue({payEnabled:true,pickupEnabled:true});m.order.mockResolvedValue({...await m.order(),paymentStatus:"PAID"});
    expect(await render()).toContain("付款狀態可查・新付款停用");
  });
  it("hides unusable pickup credentials after full refund while retaining payment history",async()=>{
    m.order.mockResolvedValue({...await m.order(),paymentStatus:"REFUNDED"});
    const html=await render();
    expect(html).toContain("已退款");expect(html).toContain("付款狀態可查・新付款停用");
    expect(html).not.toContain("取餐憑證可查");
  });
  it("does not offer payment when this store has no configured connection",async()=>{
    m.runtime.mockReturnValue({payEnabled:true});
    m.query.mockResolvedValue([{has_payment:false,pickup_required:true,payment_configured:false}]);
    expect(await render()).not.toContain("付款狀態可查");
  });
  it("offers payment for this store's configured connection",async()=>{
    m.runtime.mockReturnValue({payEnabled:true});
    m.query.mockResolvedValue([{has_payment:false,pickup_required:true,payment_configured:true}]);
    expect(await render()).toContain("付款狀態可查・新付款開放");
    expect(m.query.mock.calls[0].slice(1)).toEqual(["org-a","stall-a",id]);
  });
  it("keeps existing recovery after a store connection is disabled",async()=>{
    m.runtime.mockReturnValue({payEnabled:true});
    m.query.mockResolvedValue([{has_payment:true,pickup_required:true,payment_configured:false}]);
    expect(await render()).toContain("付款狀態可查・新付款停用");
  });
  it("rejects another member before reading order or payment capabilities",async()=>{
    m.owner.mockRejectedValue(new Error("OWNER_DENIED"));await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(m.order).not.toHaveBeenCalled();expect(m.query).not.toHaveBeenCalled();
  });
});
