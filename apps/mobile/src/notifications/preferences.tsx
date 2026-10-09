import {useEffect,useState} from "react";
import {Controller,useForm} from "react-hook-form";
import {Pressable,Text,View} from "react-native";
import {z} from "zod";
import {inboxPreferencesSchema,inboxPreferenceCommandSchema,type InboxPreferences} from "@stallorder/contracts/notifications/v1";
import type {ClientScope} from "@stallorder/contracts/operations/v1";
import {nativeRequest} from "../api/operations";
import {useSession} from "../auth/session-context";
import {useNativeRead} from "../operations/query";
const response=z.object({version:z.literal("v1"),preferences:inboxPreferencesSchema}).strict();
const fields=[["billingVisible","顯示帳務通知"],["applicationVisible","顯示申請通知"],["staffOrderVisible","顯示訂單通知"],["analyticsConsent","同意非必要產品分析（預設關閉）"]] as const;
export function InboxPreferencesForm({scope}:{scope:ClientScope|undefined}){
 const {runAuthenticated,generation}=useSession();const [message,setMessage]=useState("");const [conflict,setConflict]=useState(false);
 const current=useNativeRead(scope,"native-inbox-preferences",{},()=>runAuthenticated((token,device)=>nativeRequest(token,device,"/notification-preferences",response)));
 const form=useForm<InboxPreferences>();
 useEffect(()=>{if(current.data&&!form.formState.isDirty&&!conflict)form.reset(current.data.preferences);},[current.data,form,conflict]);
 const save=form.handleSubmit(async value=>{const issued=generation;setMessage("");try{const command=inboxPreferenceCommandSchema.parse(value);const result=await runAuthenticated((token,device)=>nativeRequest(token,device,"/notification-preferences",response,{method:"PATCH",body:JSON.stringify(command)}));if(issued===generation){form.reset(result.preferences);setMessage("偏好已儲存。");void current.refetch();}}catch(error){if(error&&typeof error==='object'&&'status'in error&&error.status===409){setConflict(true);setMessage("偏好已被另一個畫面更新。已保留您的輸入，請重新讀取後再儲存。");}else setMessage("無法儲存偏好，已保留您的輸入，請確認連線後再試。");}});
 return <View style={{gap:8,paddingVertical:16}}><Text style={{fontSize:22}}>個人通知偏好</Text><Text>設定只影響您的通知顯示；不會啟用推播或行銷寄送。</Text>{current.data&&fields.map(([name,label])=><Controller key={name} control={form.control} name={name} render={({field})=><Pressable accessibilityRole="checkbox" accessibilityLabel={label} accessibilityState={{checked:!!field.value,disabled:form.formState.isSubmitting}} disabled={form.formState.isSubmitting} onPress={()=>field.onChange(!field.value)} style={{minWidth:48,minHeight:48,justifyContent:"center",padding:12,borderWidth:1,borderColor:"#cbd5e1"}}><Text>{field.value?"☑":"☐"} {label}</Text></Pressable>}/>)}
 {(message||current.error)&&<Text accessibilityRole="alert">{message||"無法讀取偏好，請重新讀取。"}</Text>}
 <Pressable accessibilityRole="button" disabled={!current.data||conflict||form.formState.isSubmitting} onPress={()=>void save()} style={{minHeight:48,minWidth:48,padding:12,backgroundColor:"#dff7f2"}}><Text>儲存偏好</Text></Pressable>
 <Pressable accessibilityRole="button" disabled={form.formState.isSubmitting} onPress={()=>void current.refetch().then(result=>{if(result.data){form.reset(result.data.preferences);setConflict(false);setMessage("已重新讀取最新偏好，請確認後儲存。");}})} style={{minHeight:48,minWidth:48,padding:12}}><Text>重新讀取偏好</Text></Pressable></View>;
}
