import {Redirect,router,useLocalSearchParams} from 'expo-router';
import {Pressable,ScrollView,Text,View} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {dashboard} from '../src/api/client';
import {useSession} from '../src/auth/session-context';
import {useNativeScope,useNativeRead} from '../src/operations/query';
import {formatMoney} from '../src/operations/presentation';
export default function DashboardScreen(){
 const {stallId}=useLocalSearchParams<{stallId:string}>();const {bootstrapData,runAuthenticated}=useSession();
 const workspace=bootstrapData?.workspaces.find(w=>w.stalls.some(s=>s.id===stallId));const stall=workspace?.stalls.find(s=>s.id===stallId);const allowed=stall?.permissions.includes('VIEW_REPORTS');const scope=useNativeScope(workspace?.id);
 const result=useNativeRead(allowed?scope.data:undefined,'native-dashboard',{stallId},()=>runAuthenticated((token,device)=>dashboard(token,device,stallId)));
 if(!bootstrapData)return <Redirect href='/login'/>;
 if(!allowed||!stall)return <Text accessibilityRole='alert'>目前無權檢視此攤位營運概況</Text>;
 const data=result.error?undefined:result.data;
 return <SafeAreaView style={{flex:1}}><ScrollView contentContainerStyle={{padding:20,gap:16}}><Pressable accessibilityRole='button' style={{minHeight:48,minWidth:48}} onPress={()=>router.back()}><Text>返回</Text></Pressable><Text style={{fontSize:26}}>攤點通・營運概況</Text><Text>{stall.name}</Text>{result.error&&<Text accessibilityRole='alert'>無法更新營運概況，請重新整理。</Text>}{data&&<><Text>{data.date}</Text>{[['營業額',formatMoney(data.summary.totalSales,data.stall.defaultCurrency)],['訂單數',data.summary.orderCount],['已完成',data.summary.completedOrderCount],['待處理',data.summary.pendingOrderCount],['已取消',data.summary.cancelledOrderCount]].map(([label,value])=><View key={label}><Text>{label}</Text><Text style={{fontSize:22}}>{value}</Text></View>)}{data.alerts.map(alert=><Text key={alert.id} accessibilityRole='alert'>{alert.message}</Text>)}{data.kdsQueue&&<Text>廚房待製作 {data.kdsQueue.pending} 筆・製作中 {data.kdsQueue.preparing} 筆</Text>}{data.pendingPrintJobCount!==null&&<Text>待列印 {data.pendingPrintJobCount} 筆</Text>}<Text>{data.openCashShift?'目前有開啟的收銀班次':'目前沒有開啟的收銀班次'}</Text></>}<Pressable accessibilityRole='button' style={{minHeight:48,minWidth:48}} onPress={()=>void result.refetch()}><Text>重新整理概況</Text></Pressable></ScrollView></SafeAreaView>;
}
