import {beforeEach,expect,it,vi} from "vitest";
import type {ReactElement} from "react";

const harness=vi.hoisted(()=>({states:[] as unknown[],cursor:0,effects:[] as (()=>void)[],value:null as unknown}));
const controller=vi.hoisted(()=>({initialize:vi.fn(),refresh:vi.fn(),signOut:vi.fn(),signIn:vi.fn(),run:vi.fn()}));
vi.mock("react",async()=>({...await vi.importActual<typeof import("react")>("react"),
 useState:(initial:unknown)=>{const i=harness.cursor++;if(!(i in harness.states))harness.states[i]=initial;return[harness.states[i],(v:unknown)=>{harness.states[i]=v;}];},
 useMemo:(factory:()=>unknown)=>factory(),useEffect:(effect:()=>void)=>{harness.effects.push(effect);},useContext:()=>harness.value,
}));
vi.mock("./session-controller",()=>({createSessionController:()=>controller,RetiredSession:class extends Error{}}));
vi.mock("./session-store",()=>({clearStoredSession:vi.fn(),getOrCreateDeviceId:vi.fn(),getStoredSession:vi.fn(),setStoredSession:vi.fn()}));
vi.mock("../api/client",()=>({bootstrap:vi.fn(),login:vi.fn(),logout:vi.fn(),refreshSession:vi.fn()}));
vi.mock("react-native",()=>({ActivityIndicator:"ActivityIndicator",Pressable:"Pressable",Text:"Text",View:"View",StyleSheet:{create:(s:unknown)=>s}}));
vi.mock("expo-router",()=>({Redirect:"Redirect"}));
import {SessionProvider,useSession} from "./session-context";
import IndexScreen from "../../app/index";
function render(){harness.cursor=0;const element=SessionProvider({children:null}) as ReactElement<{value:ReturnType<typeof useSession>}>;harness.value=element.props.value;return element.props.value;}
beforeEach(()=>{vi.clearAllMocks();harness.states=[];harness.cursor=0;harness.effects=[];harness.value=null;controller.initialize.mockResolvedValue(undefined);controller.refresh.mockResolvedValue(undefined);controller.signOut.mockResolvedValue(true);});

it("describes an offline restore without claiming validity or forcing re-login",async()=>{
 controller.initialize.mockRejectedValue(new TypeError("Network request failed"));render();harness.effects[0]();
 await vi.waitFor(()=>expect(render().loading).toBe(false));
 expect(render().error).toBe("暫時無法連線確認登入狀態，請檢查網路後重試。");expect(controller.signOut).not.toHaveBeenCalled();
});
it("handles repeated reconnect failures and clears an old error after success",async()=>{
 controller.refresh.mockRejectedValueOnce(new TypeError("Network request failed"));await expect(render().refresh()).resolves.toBeUndefined();
 expect(render().loading).toBe(false);expect(render().error).toContain("無法連線");
 await render().refresh();expect(render().error).toBeNull();
});
it("reports rejected authority separately from unavailable transport",async()=>{
 controller.refresh.mockRejectedValue({status:401});await expect(render().refresh()).resolves.toBeUndefined();
 expect(render().error).toBe("登入狀態已失效，請重新登入。");
});
it("keeps server revocation uncertainty visible after explicit local sign-out",async()=>{
 controller.signOut.mockResolvedValue(false);await render().signOut();
 expect(render().error).toBe("裝置已登出；連線失敗，伺服器撤銷尚未確認。");expect(render().loading).toBe(false);
});
it("handles an owned storage clear failure without an unhandled UI promise",async()=>{
 controller.signOut.mockRejectedValue(Error("storage unavailable"));await expect(render().signOut()).resolves.toBeUndefined();
 expect(render().error).toBe("無法完成裝置登出，請稍後再試。");expect(render().loading).toBe(false);
});
it("offers an explicit controller logout escape on the unresolved restore screen",async()=>{
 const value={...render(),loading:false,session:{token:"x",expiresAt:"2099-01-01"},bootstrapData:null};harness.value=value;
 const tree=IndexScreen();const text=JSON.stringify(tree);expect(text).not.toContain("Session 仍有效");expect(text).toContain("尚未取得工作區");
 const children=(tree.props as {children:ReactElement[]}).children;const exit=children.find(child=>JSON.stringify(child).includes("登出並重新登入"));expect(exit).toBeDefined();
 await (exit!.props as {onPress:()=>Promise<void>}).onPress();expect(controller.signOut).toHaveBeenCalledOnce();
});
