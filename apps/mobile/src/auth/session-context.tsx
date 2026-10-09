import type {MobileSession,MobileBootstrapResponse} from "@stallorder/contracts/mobile/v1";
import {createContext,useContext,useEffect,useMemo,useState} from "react";
import {bootstrap,login,logout,refreshSession} from "../api/client";
import {clearStoredSession,getOrCreateDeviceId,getStoredSession,setStoredSession} from "./session-store";
import {createSessionController,RetiredSession} from "./session-controller";
type Value={loading:boolean;session:MobileSession|null;bootstrapData:MobileBootstrapResponse|null;generation:number;error:string|null;signIn(email:string,password:string):Promise<void>;signOut():Promise<void>;refresh():Promise<void>;runAuthenticated<T>(op:(token:string,device:string)=>Promise<T>):Promise<T>};
const Context=createContext<Value|null>(null);
function recoveryError(error:unknown){
 if(error&&typeof error==="object"&&(("status"in error&&(error.status===401||error.status===403))||("code"in error&&["MOBILE_NOT_ENABLED","MOBILE_PLATFORM_ADMIN_NOT_ENABLED"].includes(String(error.code)))))return "登入狀態已失效，請重新登入。";
 if(error instanceof TypeError)return "暫時無法連線確認登入狀態，請檢查網路後重試。";
 return "暫時無法取得工作區，請稍後再試。";
}
export function SessionProvider({children}:{children:React.ReactNode}){
 const [state,setState]=useState({session:null as MobileSession|null,bootstrapData:null as MobileBootstrapResponse|null,generation:0});
 const [loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
 const controller=useMemo(()=>createSessionController({read:getStoredSession,write:value=>value?setStoredSession(value):clearStoredSession(),device:getOrCreateDeviceId,login,rotate:refreshSession,revoke:logout,bootstrap,changed:setState}),[]);
 useEffect(()=>{let active=true;void controller.initialize().catch(e=>{if(active&&!(e instanceof RetiredSession))setError(recoveryError(e));}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[controller]);
 const value=useMemo<Value>(()=>({...state,loading,error,runAuthenticated:controller.run,
 async signIn(email,password){setLoading(true);setError(null);try{await controller.signIn(email,password);}catch(e){if(!(e instanceof RetiredSession))setError(e instanceof Error?e.message:"登入失敗。");throw e;}finally{setLoading(false);}},
 async signOut(){setLoading(true);try{const confirmed=await controller.signOut();setError(confirmed?null:"裝置已登出；連線失敗，伺服器撤銷尚未確認。");}catch{setError("無法完成裝置登出，請稍後再試。");}finally{setLoading(false);}},
 async refresh(){setLoading(true);setError(null);try{await controller.refresh();}catch(e){if(!(e instanceof RetiredSession))setError(recoveryError(e));}finally{setLoading(false);}}
 }),[state,loading,error,controller]);
 return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useSession(){const value=useContext(Context);if(!value)throw Error("SessionProvider required");return value;}
