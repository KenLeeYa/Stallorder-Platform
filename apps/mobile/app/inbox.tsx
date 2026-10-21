import {useState} from 'react';
import {Pressable,ScrollView,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {Redirect,router,useLocalSearchParams} from 'expo-router';
import {useInfiniteQuery,useQueryClient} from '@tanstack/react-query';
import {z} from 'zod';
import {inboxListSchema,inboxScopeParams,type InboxScope} from '@stallorder/contracts/notifications/v1';
import {operationsKey} from '@stallorder/contracts/operations/v1/query-key';
import {useSession} from '../src/auth/session-context';
import {nativeRequest} from '../src/api/operations';
import {nativeRead,useNativeScope,useReadCadence} from '../src/operations/query';
import {InboxPreferencesForm} from '../src/notifications/preferences';
const button={minHeight:48,minWidth:48,justifyContent:'center' as const};
export default function InboxScreen(){
 const {bootstrapData,runAuthenticated,generation}=useSession();const params=useLocalSearchParams<{organizationId?:string;stallId?:string;applicationId?:string}>();const[error,setError]=useState('');
 const workspace=params.organizationId?bootstrapData?.workspaces.find(w=>w.id===params.organizationId):undefined;const stall=workspace?.stalls.find(s=>s.id===params.stallId);
 const allowed=(!params.organizationId||!!workspace)&&(!params.stallId||!!stall)&&(!params.applicationId||bootstrapData?.principal.platformRole==='PLATFORM_ADMIN');
 const scope=useNativeScope(workspace?.id);const client=useQueryClient(),cadence=useReadCadence();
 const inboxScope:InboxScope=params.applicationId?{kind:'ADMIN_APPLICATION',applicationId:params.applicationId}:stall?{kind:'STALL',stallSlug:stall.slug}:workspace?{kind:'ORGANIZATION',organizationId:workspace.id}:{kind:'PERSONAL'};
 const search=inboxScopeParams(inboxScope);const input=inboxScope;const key=scope.data?operationsKey(scope.data,'native-inbox',input):['native-pending-inbox'];
 const list=useInfiniteQuery({queryKey:key,initialPageParam:undefined as string|undefined,enabled:allowed&&!!scope.data&&cadence!==false,refetchInterval:cadence,queryFn:({pageParam,signal})=>nativeRead(client,key,signal,()=>runAuthenticated((token,device)=>{const query=new URLSearchParams(search);if(pageParam)query.set('cursor',pageParam);return nativeRequest(token,device,'/notifications?'+query,inboxListSchema,{signal});})),getNextPageParam:page=>page.nextCursor??undefined});
 const items=list.error?[]:[...new Map((list.data?.pages.flatMap(p=>p.items)??[]).map(item=>[item.source+item.id,item])).values()];
 if(!bootstrapData)return <Redirect href='/login'/>;
 if(!allowed)return <SafeAreaView><Text accessibilityRole='alert'>無法存取指定通知範圍</Text><Pressable accessibilityRole='button' style={button} onPress={()=>router.replace('/home')}><Text>返回首頁</Text></Pressable></SafeAreaView>;
 return <SafeAreaView style={{flex:1}}><ScrollView contentContainerStyle={{padding:20,gap:12}}><Pressable accessibilityRole='button' style={button} onPress={()=>router.back()}><Text>返回</Text></Pressable><Text style={{fontSize:26}}>攤點通・通知中心</Text><Text>{list.data?'未讀 '+list.data.pages[0].unreadCount:'正在讀取通知…'}</Text>{(error||list.error)&&<Text accessibilityRole='alert'>{error||'無法讀取通知，請確認目前權限。'}</Text>}
 {items.map(item=><View key={item.source+item.id} style={{padding:16,borderWidth:1,borderColor:'#cbd5e1',gap:8}}><Text>{item.title}</Text><Text>{item.message}</Text><Text>{item.readAt?'已讀':'未讀'}</Text><Pressable accessibilityRole='button' style={button} onPress={()=>void runAuthenticated((token,device)=>nativeRequest(token,device,'/notifications/'+item.source+'/'+item.id+'/read?'+search,z.object({version:z.literal('v1'),readAt:z.string()}).passthrough(),{method:'PATCH',body:'{}'})).then(()=>list.refetch()).catch(()=>setError('無法標記已讀，請重試。'))}><Text>標記已讀</Text></Pressable>
 {item.target.kind==='ADMIN_APPLICATION'&&bootstrapData.principal.platformRole==='PLATFORM_ADMIN'?<Pressable accessibilityRole='button' style={button} onPress={()=>router.push({pathname:'/application/[applicationId]',params:{applicationId:item.target.kind==='ADMIN_APPLICATION'?item.target.applicationId:''}})}><Text>查看申請</Text></Pressable>:item.target.kind==='STAFF_BOARD'&&stall&&item.target.stallSlug===stall.slug?<Pressable accessibilityRole='button' style={button} onPress={()=>router.push({pathname:'/orders',params:{stallId:stall.id}})}><Text>查看攤位訂單</Text></Pressable>:<Text>此通知的詳細功能尚未於行動版開放。</Text>}</View>)}
 {list.hasNextPage&&<Pressable accessibilityRole='button' style={button} disabled={list.isFetching} onPress={()=>void list.fetchNextPage()}><Text>載入更多通知</Text></Pressable>}
 <Pressable accessibilityRole='button' style={button} onPress={()=>void list.refetch()}><Text>重新整理通知</Text></Pressable><InboxPreferencesForm key={generation+JSON.stringify(scope.data)} scope={scope.data}/></ScrollView></SafeAreaView>;
}
