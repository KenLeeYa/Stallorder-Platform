import {loadEnvFile} from 'node:process';
import {readFileSync,writeFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {openGuardedDatabase,verifyLiveFixture} from '../../../docs/awesome-optimization/qa/live-fixture-guard.mjs';
import {readResponsiveBuildProvenance} from '../../responsive-build-provenance.mjs';
loadEnvFile('.env.local');
const label=process.argv[2];if(!/^[a-z0-9-]+$/.test(label??''))throw Error('B4A_LABEL_REQUIRED');
const path=`.superpowers/sdd/2026-10-01-awesome-optimization/batch-4a/constraints-${label}.json`;if(existsSync(path))throw Error('IMMUTABLE_RECEIPT_EXISTS');
const runtime=readResponsiveBuildProvenance({expectedSourceSha256:process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256});
const db=await openGuardedDatabase(),checks=[];
let before,receiptFd,primaryError,receiptAttempted=false;
function sql(name,command,expected){const result=spawnSync('docker',['exec','-i','supabase_db_stallorder-responsive-20260930','psql','-X','-v','ON_ERROR_STOP=1','-v','VERBOSITY=verbose','-U','postgres','-d','postgres'],{input:`BEGIN;\n${command}\nROLLBACK;`,encoding:'utf8',windowsHide:true});checks.push({name,exitCode:result.status,stdout:result.stdout,stderr:result.stderr,transaction:'ROLLBACK or connection-close rollback'});if(expected){assert.notEqual(result.status,0);assert.match(result.stderr,new RegExp(expected));}else assert.equal(result.status,0);}
try{
 before=(await verifyLiveFixture(db)).receipt;
 receiptFd=openSync(path,'wx');
 for(const role of ['anon','authenticated'])for(const table of ['notification_preferences','notification_read_receipts'])for(const operation of ['SELECT * FROM','INSERT INTO','UPDATE','DELETE FROM']){const tail=operation==='INSERT INTO'?' DEFAULT VALUES':operation==='UPDATE'?(table==='notification_preferences'?' SET version=version':' SET read_at=read_at'):'';sql(`${role}/${table}/${operation}`,`SET LOCAL ROLE ${role}; ${operation} public.${table}${tail};`,'42501');}
 const profile=randomUUID(),order=randomUUID(),delivery=randomUUID(),receipt=randomUUID();
 const seed=`INSERT INTO profiles(id,display_name,email) VALUES('${profile}','B4a transaction-only','awesome-b4a-sql-${profile}@stallorder.test');`;
 sql('default preference false and positive CAS version',`${seed} INSERT INTO notification_preferences(profile_id) VALUES('${profile}'); DO $$ BEGIN IF NOT EXISTS(SELECT 1 FROM notification_preferences WHERE profile_id='${profile}' AND billing_visible AND application_visible AND staff_order_visible AND NOT analytics_consent AND version=1) THEN RAISE EXCEPTION 'DEFAULT_MISMATCH'; END IF; END $$;`);
 sql('zero version rejected',`${seed} INSERT INTO notification_preferences(profile_id,version) VALUES('${profile}',0);`,'23514');
 sql('missing receipt source rejected',`${seed} INSERT INTO notification_read_receipts(id,profile_id) VALUES('${receipt}','${profile}');`,'23514');
 sql('two receipt source choices rejected',`${seed} INSERT INTO notification_read_receipts(profile_id,billing_notification_id,application_notification_id) VALUES('${profile}','${randomUUID()}','${randomUUID()}');`,'23514');
 sql('missing billing FK rejected',`${seed} INSERT INTO notification_read_receipts(profile_id,billing_notification_id) VALUES('${profile}','${randomUUID()}');`,'23503');
 sql('missing composite staff source rejected',`${seed} INSERT INTO notification_read_receipts(profile_id,staff_delivery_id,staff_order_id) VALUES('${profile}','${delivery}','${order}');`,'23503');
 sql('one preference per profile',`${seed} INSERT INTO notification_preferences(profile_id) VALUES('${profile}'),('${profile}');`,'23505');
 const source=await db.merchantApplicationNotification.findFirst({select:{id:true}});assert.ok(source,'Existing application source required');
 sql('one personal receipt per application source',`${seed} INSERT INTO notification_read_receipts(profile_id,application_notification_id) VALUES('${profile}','${source.id}'),('${profile}','${source.id}');`,'23505');
 const deliverySource=await db.staffPushDelivery.findFirst({where:{subscription:{profile:{email:{startsWith:'awesome-b4a-'}}},orderId:{not:null}},select:{id:true,orderId:true}});assert.ok(deliverySource,'Run actual order source-chain proof first');
 const otherOrder=await db.order.findFirst({where:{id:{not:deliverySource.orderId}},select:{id:true}});assert.ok(otherOrder);
 sql('actual delivery paired with different existing order rejected by composite FK',`${seed} INSERT INTO notification_read_receipts(profile_id,staff_delivery_id,staff_order_id) VALUES('${profile}','${deliverySource.id}','${otherOrder.id}');`,'notification_receipt_staff_source_fk');
 sql('one personal receipt per real order source',`${seed} INSERT INTO notification_read_receipts(profile_id,staff_delivery_id,staff_order_id) VALUES('${profile}','${deliverySource.id}','${deliverySource.orderId}'),('${profile}','${deliverySource.id}','${deliverySource.orderId}');`,'notification_receipt_profile_order_key');
 const migration=readFileSync('supabase/migrations/20261001120000_personal_notification_inbox.sql','utf8');assert.ok(!migration.includes('DROP CONSTRAINT'));
 const result={runtime,before,after:(await verifyLiveFixture(db)).receipt,checks,status:'PASS',persistedTestWrites:0};
 receiptAttempted=true;
 writeFileSync(receiptFd,JSON.stringify(result,null,2)+'\n');
}catch(error){
 primaryError=error;
 if(receiptFd!==undefined&&!receiptAttempted)try{writeFileSync(receiptFd,JSON.stringify({runtime,before,checks,status:'FAIL',error:String(error)},null,2)+'\n');}catch{error.receiptWriteFailed=true;}
 throw error;
}finally{
 let cleanupError;
 if(receiptFd!==undefined)try{closeSync(receiptFd);}catch(error){cleanupError=error;}
 try{await db.$disconnect();}catch(error){cleanupError??=error;}
 if(cleanupError){if(primaryError)primaryError.cleanupFailed=true;else throw cleanupError;}
}
