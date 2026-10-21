import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomBytes} from 'node:crypto';
import {loadEnvFile} from 'node:process';
import {execFileSync} from 'node:child_process';
import bcrypt from 'bcryptjs';
import {openNativeDatabase,evidence,plain,sha,projectOldSession} from './database-guard.mjs';
import {preserveNativeInputs} from './preservation.mjs';
loadEnvFile('.env.local');
assert.equal(execFileSync('powershell',['-NoProfile','-Command','@(Get-NetTCPConnection -State Listen -LocalPort 3026 -ErrorAction SilentlyContinue).Count'],{encoding:'utf8'}).trim(),'0');
assert.equal(sha(readFileSync(evidence+'/reuse-actor-plan-v1.json')),'cf051bf41c960703098186563ec3cd546b09853aec6e982f926914bad1d92089');
const plan=JSON.parse(readFileSync(evidence+'/reuse-actor-plan-v1.json','utf8'));
const original=JSON.parse(readFileSync(evidence+'/ddl-before.json','utf8')).sessionRows;
assert.equal(original.length,1326);
const save=(name,value)=>writeFileSync(evidence+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});
const db=await openNativeDatabase();
async function originalSessions(tx){const rows=plain(await tx.authSession.findMany({where:{id:{in:original.map(r=>r.id)}},orderBy:{id:'asc'}}));assert.deepEqual(rows.map(projectOldSession),original);return {count:rows.length,sha256:sha(JSON.stringify(rows))};}
try{
 const protectedFacts=await preserveNativeInputs(db),sessions=await originalSessions(db);
 const profiles=await db.profile.findMany({orderBy:{id:'asc'}});
 const profileEvidence=profiles.map(row=>({id:row.id,sessionVersion:row.sessionVersion,sha256:sha(JSON.stringify(plain(row)))}));
 const models=['organization','stall','subscription','order','orderItem','organizationMembership','stallMembership','usageEvent','stallCapacitySettings','kitchenStation','pickupDisplaySettings','dailyStallSummary','notificationOutbox'];
 const scope={};for(const model of models)scope[model]=plain(await db[model].findMany({where:model==='organization'?{id:plan.organizationId}:{organizationId:plan.organizationId},orderBy:{id:'asc'}}));
 const catalogue=plain(await db.$queryRaw`select t.tgname,pg_get_triggerdef(t.oid) as definition,pg_get_functiondef(t.tgfoid) as function from pg_trigger t where not t.tgisinternal and t.tgrelid='public.profiles'::regclass order by t.tgname`);
 // Profiles are created through the same Prisma domain model as existing local fixtures. No auth-provider identity is created.
 assert.equal(catalogue.length,0,'UNREVIEWED_PROFILE_TRIGGER');
 save('reuse-actor-before',{source:process.env.B5_ROOT_SOURCE,plan,protectedFacts,sessions,profileEvidence,scope,catalogue});
 const password=randomBytes(30).toString('base64url');const passwordHash=await bcrypt.hash(password,12);
 save('runtime-local-secret',{email:plan.email,password});
 const result=await db.$transaction(async tx=>{
  assert.equal(await tx.profile.count({where:{OR:[{id:plan.profileId},{email:plan.email}]}}),0);
  assert.equal(await tx.stallMembership.count({where:{id:plan.membershipId}}),0);
  await tx.profile.create({data:{id:plan.profileId,email:plan.email,displayName:plan.displayName,passwordHash,isActive:true,platformRole:null,sessionVersion:1}});
  const membership=await tx.stallMembership.create({data:{id:plan.membershipId,organizationId:plan.organizationId,stallId:plan.stallId,profileId:plan.profileId,role:'STAFF',isActive:true}});
  await tx.$executeRaw`set constraints all immediate`;
  for(const model of models){const rows=plain(await tx[model].findMany({where:model==='organization'?{id:plan.organizationId}:{organizationId:plan.organizationId},orderBy:{id:'asc'}}));
   if(model==='stallMembership'){assert.equal(rows.length,scope[model].length+1);assert.deepEqual(rows.filter(r=>r.id!==plan.membershipId),scope[model]);}
   else if(model==='usageEvent'){const added=rows.filter(r=>!scope[model].some(old=>old.id===r.id));assert.equal(added.length,1);assert.equal(added[0].eventType,'STAFF_MEMBERSHIP_CHANGED');assert.equal(added[0].quantity,1);assert.ok(added[0].referenceId.includes(plan.membershipId));assert.deepEqual(rows.filter(r=>scope[model].some(old=>old.id===r.id)),scope[model]);}
   else assert.deepEqual(rows,scope[model]);
  }
  assert.deepEqual(await tx.profile.findMany({where:{id:{in:profiles.map(p=>p.id)}},orderBy:{id:'asc'}}),profiles);
  await originalSessions(tx);await preserveNativeInputs(tx);
  return {profile:await tx.profile.findUniqueOrThrow({where:{id:plan.profileId},select:{id:true,email:true,displayName:true,platformRole:true,isActive:true,sessionVersion:true}}),membership};
 },{timeout:60000});
 save('reuse-actor-after',{source:process.env.B5_ROOT_SOURCE,result:plain(result),preserved:await preserveNativeInputs(db),sessions:await originalSessions(db),profilesUnchanged:profileEvidence});
 console.log('NATIVE_REUSE_ACTOR_CREATED_LOCAL_ONLY');
}finally{await db.$disconnect();}
