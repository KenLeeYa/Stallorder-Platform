import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {execFileSync} from 'node:child_process';
import {openNativeDatabase,evidence,assertAudienceCatalogue,plain,sha} from './database-guard.mjs';
import {assertFixtureCatalogue} from './fixture-catalogue-v3.mjs';
import {preserveNativeInputs} from './preservation.mjs';
loadEnvFile('.env.local');
assert.equal(execFileSync('powershell',['-NoProfile','-Command','@(Get-NetTCPConnection -State Listen -LocalPort 3026 -ErrorAction SilentlyContinue).Count'],{encoding:'utf8'}).trim(),'0');
const plan=JSON.parse(readFileSync(evidence+'/database-fixture-bundle-v3.json','utf8')),f=plan.fixture;
const save=(name,value)=>writeFileSync(evidence+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});
assert.equal(sha(readFileSync(evidence+'/database-fixture-pins-v3.json')),'87f582e53cf7eec9fdc60e3b1830b82a4a2648c63308d51ca204e3b6fb889e0d');for(const [file,hash]of Object.entries(JSON.parse(readFileSync(evidence+'/database-fixture-pins-v3.json','utf8'))))assert.equal(sha(readFileSync(file)),hash);
const db=await openNativeDatabase();
try {
 await assertAudienceCatalogue(db);const catalogue=await assertFixtureCatalogue(db);const before=await preserveNativeInputs(db);
 const profiles=await db.profile.findMany({where:{OR:[{id:{in:[f.owner,f.parity,f.admin]}},{email:{in:['awesome-b2-parity-finance@stallorder.test','kitchen@stallorder.test']}}]},select:{id:true,email:true,isActive:true,platformRole:true}});
 assert.equal(profiles.length,5);assert.ok(profiles.every(p=>p.isActive));
 const finance=profiles.find(p=>p.email==='awesome-b2-parity-finance@stallorder.test'),kitchen=profiles.find(p=>p.email==='kitchen@stallorder.test');assert.ok(finance&&kitchen);assert.equal(finance.id,f.finance.id);assert.equal(kitchen.id,f.kitchen.id);const financeRole=await db.organizationMembership.findUnique({where:{id:f.finance.membershipId},select:{profileId:true,organizationId:true,role:true,isActive:true}});assert.deepEqual(financeRole,{profileId:f.finance.id,organizationId:f.finance.organizationId,role:'FINANCE_VIEWER',isActive:true});const kitchenRole=await db.stallMembership.findUnique({where:{id:f.kitchen.membershipId},select:{profileId:true,organizationId:true,stallId:true,role:true,isActive:true}});assert.deepEqual(kitchenRole,{profileId:f.kitchen.id,organizationId:f.kitchen.organizationId,stallId:f.kitchen.stallId,role:'KITCHEN',isActive:true});
 const roles={owner:'ORGANIZATION_OWNER',parity:'ORGANIZATION_OWNER',finance:'FINANCE_VIEWER',kitchen:'KITCHEN'},ids={owner:f.owner,parity:f.parity,finance:finance.id,kitchen:kitchen.id};
 assert.equal(profiles.find(p=>p.id===f.admin).platformRole,'PLATFORM_ADMIN');
 for(const key of Object.keys(ids)){const role=roles[key],profileId=ids[key];assert.equal(profiles.find(p=>p.id===profileId).platformRole,null);assert.ok((await db.organizationMembership.count({where:{profileId,role,isActive:true}}))+(await db.stallMembership.count({where:{profileId,role,isActive:true}}))>0,'NATIVE_EXISTING_ROLE_REQUIRED '+key);}
 assert.equal(f.orders.length,500);assert.equal(f.itemIds.length,500);assert.equal(new Set([...f.orders,...f.itemIds]).size,1000);
 save('fixture-v3-before',{source:process.env.B5_ROOT_SOURCE,before,profiles,roles,ids});
 const actualPlan=await db.planVersion.findUniqueOrThrow({where:{id:f.plan.id},select:{id:true,planId:true,billingInterval:true,pricingMode:true,maxStalls:true,includedStalls:true,maxStaff:true,includedOrders:true,overagePolicy:true,plan:{select:{code:true,isActive:true}}}});assert.deepEqual(actualPlan,f.plan);
 const result=await db.$transaction(async tx=>{
  for(const [model,where]of [['organization',{OR:[{id:f.organizationId},{slug:f.slug},{email:'awesome-native@stallorder.test'}]}],['stall',{OR:[{id:f.stallId},{slug:f.slug}]}],['organizationMembership',{id:{in:f.membershipIds.map(r=>r.id)}}],['stallMembership',{id:{in:f.membershipIds.map(r=>r.id)}}],['subscription',{OR:[{id:f.subscription.id},{organizationId:f.organizationId}]}],['order',{id:{in:f.orders}}],['orderItem',{id:{in:f.itemIds}}]])assert.equal(await tx[model].count({where}),0,'NATIVE_FIXTURE_ALREADY_EXISTS '+model);
  const organization=await tx.organization.create({data:{id:f.organizationId,name:'攤點通行動版測試',businessName:'攤點通行動版測試',slug:f.slug,status:'ACTIVE',email:'awesome-native@stallorder.test',phone:'0000000000'}});
  const subscription=await tx.subscription.create({data:{...f.subscription,organizationId:f.organizationId,billingPeriodStart:new Date(f.subscription.billingPeriodStart),billingPeriodEnd:new Date(f.subscription.billingPeriodEnd)}});
  const stall=await tx.stall.create({data:{id:f.stallId,organizationId:f.organizationId,name:'行動版五百筆測試攤位',slug:f.slug,code:'NATIVE500',address:'本機測試',location:'本機測試',businessStatus:'CLOSED',orderingEnabled:false,orderingState:'CLOSED'}});
  await tx.organizationMembership.createMany({data:f.membershipIds.filter(m=>m.role!=='kitchen').map(m=>({id:m.id,organizationId:f.organizationId,profileId:ids[m.role],role:roles[m.role],allStalls:true,isActive:true,isPrimaryOwner:m.role==='owner'}))});
  await tx.stallMembership.create({data:{id:f.membershipIds.find(m=>m.role==='kitchen').id,organizationId:f.organizationId,stallId:f.stallId,profileId:f.kitchen.id,role:'KITCHEN',isActive:true}});
  const orders=f.orders.map((id,i)=>{const at=new Date(Date.UTC(2026,9,2,0,0,i));return {id,organizationId:f.organizationId,stallId:f.stallId,orderNo:'NATIVE-'+String(i+1).padStart(4,'0'),trackingTokenHash:sha('awesome-native-tracking-'+id),idempotencyKey:id,source:'STAFF',origin:'TEST',isTest:true,customerName:'行動測試客人'+(i+1),status:'COMPLETED',paymentStatus:'UNPAID',subtotal:100+i,total:100+i,deviceHash:sha('awesome-native-fixture'),confirmationExpiresAt:at,confirmedAt:at,completedAt:at,createdAt:at,updatedAt:at};});
  await tx.order.createMany({data:orders});
  await tx.orderItem.createMany({data:f.itemIds.map((id,i)=>({id,organizationId:f.organizationId,stallId:f.stallId,orderId:f.orders[i],name:'香酥手作招牌蔬食便當加雙份季節時蔬與特製醬汁第'+(i+1)+'份',baseUnitPrice:100+i,unitPrice:100+i,quantity:1,status:'SERVED',createdAt:orders[i].createdAt}))});
  const actualOrders=await tx.order.findMany({where:{organizationId:f.organizationId},orderBy:{createdAt:'asc'},include:{items:true}});assert.equal(actualOrders.length,500);assert.deepEqual(actualOrders.map(r=>r.id),f.orders);assert.ok(actualOrders.every((r,i)=>r.items.length===1&&r.items[0].id===f.itemIds[i]&&r.isTest&&r.status==='COMPLETED'));
  await tx.$executeRaw`set constraints all immediate`;
  const effects={usageEvents:await tx.usageEvent.findMany({where:{organizationId:f.organizationId},orderBy:{id:'asc'}})};assert.equal(effects.usageEvents.length,5);for(const [kind,count]of Object.entries(f.expectedSideEffects.usageEvents))assert.equal(effects.usageEvents.filter(r=>r.eventType===kind&&r.quantity===1).length,count);assert.ok(effects.usageEvents.every(r=>r.referenceId?.includes(f.stallId)||f.membershipIds.some(m=>r.referenceId?.includes(m.id))));
  for(const name of ['stallCapacitySettings','kitchenStation','pickupDisplaySettings','dailyStallSummary']){effects[name]=await tx[name].findMany({where:{organizationId:f.organizationId}});assert.equal(effects[name].length,1);}
  for(const name of f.expectedSideEffects.zeroModels){effects[name]=await tx[name].count({where:{organizationId:f.organizationId}});assert.equal(effects[name],0,'NATIVE_UNEXPECTED_SIDE_EFFECT '+name);}
  const summary=effects.dailyStallSummary[0];for(const field of ['orderCount','completedOrderCount','netSales','cashAmount','manualTransferAmount','otherPaymentAmount'])assert.equal(summary[field],0);
  assert.equal(await tx.staffPushDelivery.count({where:{orderId:{in:f.orders}}}),0);
  await preserveNativeInputs(tx);return plain({organization,subscription,stall,effects,stallMemberships:await tx.stallMembership.findMany({where:{organizationId:f.organizationId},orderBy:{id:'asc'}}),memberships:await tx.organizationMembership.findMany({where:{organizationId:f.organizationId},orderBy:{id:'asc'}}),orders:actualOrders});
 },{timeout:60000});
 save('fixture-v3-after',{source:process.env.B5_ROOT_SOURCE,catalogue,data:result,sha256:sha(JSON.stringify(result)),preserved:await preserveNativeInputs(db)});console.log('NATIVE_FIXTURE_LOCAL_PASS orders=500 items=500');
}catch(error){save('fixture-v3-error',{message:String(error)});throw error;}finally{await db.$disconnect();}
