import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {loadEnvFile} from 'node:process';
import {execFileSync} from 'node:child_process';
import {openNativeDatabase,evidence,oldSessionRows,oldSessionFields,accessCatalogue,assertAudienceCatalogue,plain,sha} from './database-guard.mjs';
import {preserveNativeInputs} from './preservation.mjs';
import {assertLegacyNotificationCatalogue} from '../../../docs/awesome-optimization/qa/legacy-notification-catalogue-guard-v2.mjs';
const flags=['MOBILE_APP_ENABLED','MOBILE_PLATFORM_ADMIN_ENABLED','MOBILE_PUSH_ENABLED','MOBILE_OFFLINE_POS_ENABLED','MOBILE_DIRECT_PRINT_ENABLED'];
const plan=JSON.parse(readFileSync(evidence+'/database-bundle-v1.json','utf8'));
const save=(name,value)=>writeFileSync(evidence+'/'+name+'.json',JSON.stringify(value,null,2)+'\n',{flag:'wx'});
loadEnvFile('.env.local');
// Explicit caller target/source variables are required; neither source nor target is auto-adopted.
const listeners=execFileSync('powershell',['-NoProfile','-Command','@(Get-NetTCPConnection -State Listen -LocalPort 3026 -ErrorAction SilentlyContinue).Count'],{encoding:'utf8'}).trim();assert.equal(listeners,'0','NATIVE_APP_MUST_BE_STOPPED');
const db=await openNativeDatabase();
try{
 const beforeSessions=await oldSessionRows(db),access=await accessCatalogue(db),preserved=await preserveNativeInputs(db);
 const prior=await db.resilienceFeatureFlag.findMany({where:{code:{in:flags}},include:{overrides:true}});
 for(const row of prior){assert.equal(row.defaultEnabled,false);assert.deepEqual(row.overrides,[]);}
 assert.equal(await db.$queryRaw`select column_name from information_schema.columns where table_schema='public' and table_name='auth_sessions' and column_name='client_kind'`.then(r=>r.length),0,'NATIVE_DDL_ALREADY_APPLIED');
 save('ddl-before',{source:process.env.B5_ROOT_SOURCE,schema:plan.schemaBefore,sessionRows:beforeSessions,access,preserved,priorFlags:prior});
 const sql=readFileSync(plan.migration.path,'utf8');assert.equal(sha(sql),plan.migration.sha256);
 const catalogue=await db.$transaction(async tx=>{
  const statements=sql.match(/(?:CREATE TYPE|ALTER TABLE|INSERT INTO)[\s\S]*?;/g);assert.equal(statements?.length,3);for(const statement of statements)await tx.$executeRawUnsafe(statement);
  const result=await assertAudienceCatalogue(tx);assert.deepEqual(await oldSessionRows(tx),beforeSessions);assert.deepEqual(await accessCatalogue(tx),access);
  const kinds=await tx.authSession.findMany({select:{id:true,clientKind:true},orderBy:{id:'asc'}});assert.deepEqual(kinds,beforeSessions.map(r=>({id:r.id,clientKind:'WEB'})));
  const values=await tx.resilienceFeatureFlag.findMany({where:{code:{in:flags}},include:{overrides:true}});assert.equal(values.length,5);for(const row of values){assert.equal(row.defaultEnabled,false);assert.deepEqual(row.overrides,[]);}
  for(const row of prior)assert.deepEqual(plain(values.find(v=>v.id===row.id)),plain(row));
  await assertLegacyNotificationCatalogue(tx);await preserveNativeInputs(tx);return result;
 },{timeout:60000});
 save('ddl-after',{source:process.env.B5_ROOT_SOURCE,schema:plan.schemaAfter,catalogue,sessionRows:await oldSessionRows(db),access:await accessCatalogue(db),preserved:await preserveNativeInputs(db)});
 console.log('NATIVE_DDL_LOCAL_PASS');
}catch(error){save('ddl-error',{message:String(error)});throw error;}finally{await db.$disconnect();}
