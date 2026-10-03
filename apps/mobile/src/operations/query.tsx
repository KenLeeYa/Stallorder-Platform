import {useCallback,useEffect,useState} from "react";
import {AppState} from "react-native";
import NetInfo from "@react-native-community/netinfo";
import {QueryClient,QueryClientProvider,focusManager,onlineManager,useQuery,useQueryClient} from "@tanstack/react-query";
import {useFocusEffect} from "expo-router";
import {clientScopeSchema,type ClientScope} from "@stallorder/contracts/operations/v1";
import {operationsKey} from "@stallorder/contracts/operations/v1/query-key";
import {useSession} from "../auth/session-context";
import {apiBaseUrl,authenticatedHeaders,responseJson,MobileApiError} from "../api/client";
function useIsFocused(){const [focused,setFocused]=useState(false);useFocusEffect(useCallback(()=>{setFocused(true);return()=>setFocused(false);},[]));return focused;}
NetInfo.configure({reachabilityShouldRun:()=>false,shouldFetchWiFiSSID:false});
export function NativeQueryProvider({children}:{children:React.ReactNode}){
 const {generation}=useSession();
 useEffect(()=>{focusManager.setFocused(AppState.currentState==='active');const app=AppState.addEventListener('change',state=>focusManager.setFocused(state==='active'));const unsubscribe=NetInfo.addEventListener(state=>onlineManager.setOnline(state.isConnected===true));return()=>{app.remove();unsubscribe();};},[]);
 return <GenerationQueries key={generation}>{children}</GenerationQueries>;
}
function GenerationQueries({children}:{children:React.ReactNode}){
 const [client]=useState(()=>new QueryClient({defaultOptions:{queries:{retry:false,gcTime:0,refetchOnWindowFocus:'always',refetchOnReconnect:'always'},mutations:{retry:false}}}));
 useEffect(()=>()=>{void client.cancelQueries();client.clear();},[client]);
 return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const floors=new WeakMap<QueryClient,Map<string,number>>();
export async function nativeRead<T>(client:QueryClient,key:readonly unknown[],signal:AbortSignal,read:()=>Promise<T>):Promise<T>{
 const map=floors.get(client)??new Map<string,number>();floors.set(client,map);const id=JSON.stringify(key),deadline=map.get(id)??0;
 if(deadline>Date.now())await new Promise<void>((resolve,reject)=>{const abort=()=>{clearTimeout(timer);reject(signal.reason);};const timer=setTimeout(()=>{signal.removeEventListener("abort",abort);resolve();},deadline-Date.now());signal.addEventListener("abort",abort,{once:true});});
 if(signal.aborted)throw signal.reason;
 if(!focusManager.isFocused()||!onlineManager.isOnline())throw Error("目前已暫停同步，回到前景並連線後會重新整理。");
 try{return await read();}catch(error){if(!signal.aborted&&error instanceof MobileApiError&&error.status===429)map.set(id,error.retryAt);throw error;}
}
export function useNativeScope(organizationId?:string){
 const session=useSession();const focused=useIsFocused();
 return useQuery({queryKey:["native-context",session.generation,organizationId],enabled:!!session.bootstrapData&&focused,queryFn:({signal})=>session.runAuthenticated(async(token,device)=>clientScopeSchema.parse(await responseJson(await fetch(apiBaseUrl+"/api/mobile/v1/operations/context"+(organizationId?"?organizationId="+encodeURIComponent(organizationId):""),{signal,credentials:"omit",headers:authenticatedHeaders(token,device)}))))});
}
export function useReadCadence(){const focused=useIsFocused();const[active,setActive]=useState(focusManager.isFocused());const[online,setOnline]=useState(onlineManager.isOnline());useEffect(()=>focusManager.subscribe(setActive),[]);useEffect(()=>onlineManager.subscribe(setOnline),[]);return focused&&active&&online?15000:false;}
export function useNativeRead<T>(scope:ClientScope|undefined,resource:string,input:object,read:()=>Promise<T>){
 const client=useQueryClient();const interval=useReadCadence();const key=scope?operationsKey(scope,resource,input):["native-pending",resource,input];
 return useQuery({queryKey:key,enabled:!!scope&&interval!==false,refetchInterval:interval,queryFn:({signal})=>nativeRead(client,key,signal,read)});
}
