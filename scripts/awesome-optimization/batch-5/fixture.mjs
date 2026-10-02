import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {execFileSync} from 'node:child_process';
import {openNativeDatabase,evidence,assertAudienceCatalogue,plain,sha} from './database-guard.mjs';
import {preserveNativeInputs} from './preservation.mjs';
loadEnvFile('.env.local');
assert.equal(execFileSync('powershell',['-NoProfile','-Command','@(Get-NetTCPConnection -State Listen -LocalPort 3026 -ErrorAction SilentlyContinue).Count'],{encoding:'utf8'}).trim(),'0');
const plan=JSON.parse(readFileSync(evidence+'/database-bundle-v1.json','utf8')),f=plan.fixture;
const save=(name,value)=>writeFileSync(evidence+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const db=await openNativeDatabase();
try {
 await assertAudienceCatalogue(db);const before=await preserveNativeInputs(db);
 const profiles=await db.profile.findMany({where:{OR:[{id:{in:[f.owner,f.parity,f.admin]}},{email:{in:['finance@stallorder.test','kitchen@stallorder.test']}}]},select:{id:true,email:true,isActive:true,platformRole:true}});
 assert.equal(profiles.length,5);assert.ok(profiles.every(p=>p.isActive));
 const finance=profiles.find(p=>p.email==='finance@stallorder.test'),kitchen=profiles.find(p=>p.email==='kitchen@stallorder.test');assert.ok(finance&&kitchen);
 const roles={owner:'ORGANIZATION_OWNER',parity:'ORGANIZATION_OWNER',finance:'FINANCE_VIEWER',kitchen:'KITCHEN'},ids={owner:f.owner,parity:f.parity,finance:finance.id,kitchen:kitchen.id};
 assert.equal(profiles.find(p=>p.id===f.admin).platformRole,'PLATFORM_ADMIN');
 for(const key of Object.keys(ids)){const role=roles[key],profileId=ids[key];assert.equal(profiles.find(p=>p.id===profileId).platformRole,null);assert.ok((await db.organizationMembership.count({where:{profileId,role,isActive:true}}))+(await db.stallMembership.count({where:{profileId,role,isActive:true}}))>0,'NATIVE_EXISTING_ROLE_REQUIRED '+key);}
 assert.equal(f.orders.length,500);assert.equal(f.itemIds.length,500);assert.equal(new Set([...f.orders,...f.itemIds]).size,1000);
 save('fixture-before',{source:process.env.B5_ROOT_SOURCE,before,profiles,roles,ids});
 const result=await db.$transaction(async tx=>{
  for(const [model,where]of [['organization',{OR:[{id:f.organizationId},{slug:f.slug},{email:'awesome-native@stallorder.test'}]}],['stall',{OR:[{id:f.stallId},{slug:f.slug}]}],['organizationMembership',{id:{in:f.membershipIds.map(r=>r.id)}}],['order',{id:{in:f.orders}}],['orderItem',{id:{in:f.itemIds}}]])assert.equal(await tx[model].count({where}),0,'NATIVE_FIXTURE_ALREADY_EXISTS '+model);
  const organization=await tx.organization.create({data:{id:f.organizationId,name:'攤點通行動版測試',businessName:'攤點通行動版測試',slug:f.slug,status:'ACTIVE',email:'awesome-native@stallorder.test',phone:'0000000000'}});
  const stall=await tx.stall.create({data:{id:f.stallId,organizationId:f.organizationId,name:'行動版五百筆測試攤位',slug:f.slug,code:'NATIVE500',address:'本機測試',location:'本機測試',businessStatus:'CLOSED',orderingEnabled:false,orderingState:'CLOSED'}});
  await tx.organizationMembership.createMany({data:f.membershipIds.map(m=>({id:m.id,organizationId:f.organizationId,profileId:ids[m.role],role:roles[m.role],allStalls:true,isActive:true,isPrimaryOwner:m.role==='owner'}))});
  const orders=f.orders.map((id,i)=>{const at=new Date(Date.UTC(2026,9,2,0,0,i));return {id,organizationId:f.organizationId,stallId:f.stallId,orderNo:'NATIVE-'+String(i+1).padStart(4,'0'),trackingTokenHash:sha('awesome-native-tracking-'+id),idempotencyKey:id,source:'STAFF',origin:'TEST',isTest:true,customerName:'行動測試客人'+(i+1),status:'COMPLETED',paymentStatus:'UNPAID',subtotal:100+i,total:100+i,deviceHash:sha('awesome-native-fixture'),confirmationExpiresAt:at,confirmedAt:at,completedAt:at,createdAt:at,updatedAt:at};});
  await tx.order.createMany({data:orders});
  await tx.orderItem.createMany({data:f.itemIds.map((id,i)=>({id,organizationId:f.organizationId,stallId:f.stallId,orderId:f.orders[i],name:'香酥手作招牌蔬食便當加雙份季節時蔬與特製醬汁第'+(i+1)+'份',baseUnitPrice:100+i,unitPrice:100+i,quantity:1,status:'SERVED',createdAt:orders[i].createdAt}))});
  const actualOrders=await tx.order.findMany({where:{organizationId:f.organizationId},orderBy:{createdAt:'asc'},include:{items:true}});assert.equal(actualOrders.length,500);assert.deepEqual(actualOrders.map(r=>r.id),f.orders);assert.ok(actualOrders.every((r,i)=>r.items.length===1&&r.items[0].id===f.itemIds[i]&&r.isTest&&r.status==='COMPLETED'));
  await preserveNativeInputs(tx);return plain({organization,stall,memberships:await tx.organizationMembership.findMany({where:{organizationId:f.organizationId},orderBy:{id:'asc'}}),orders:actualOrders});
 },{timeout:60000});
 save('fixture-after',{source:process.env.B5_ROOT_SOURCE,data:result,sha256:sha(JSON.stringify(result)),preserved:await preserveNativeInputs(db)});console.log('NATIVE_FIXTURE_LOCAL_PASS orders=500 items=500');
}catch(error){save('fixture-error',{message:String(error)});throw error;}finally{await db.$disconnect();}
