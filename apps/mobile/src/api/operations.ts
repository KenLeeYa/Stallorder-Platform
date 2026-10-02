import {z} from "zod";
import {apiBaseUrl,authenticatedHeaders,responseJson} from "./client";
export async function nativeRequest<T>(token:string,device:string,path:string,schema:z.ZodType<T>,init:RequestInit={}){
 const response=await fetch(apiBaseUrl+"/api/mobile/v1"+path,{...init,credentials:"omit",headers:{...authenticatedHeaders(token,device),"content-type":"application/json",...init.headers}});
 return schema.parse(await responseJson(response));
}
