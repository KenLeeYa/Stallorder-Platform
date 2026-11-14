import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {nativeReadOnlyEnvironment,nativeReadFailure} from './delivery-native-read-connection.mjs';
import {NATIVE_PREIMAGE_SQL,verifyNativePreimage} from './delivery-database-preimage.mjs';

class PreimageCollectionError extends Error {}
export function nativePreimageCollectionFailure(error) {
 return error instanceof PreimageCollectionError?error.message:'DELIVERY_NATIVE_PREIMAGE_COLLECTION_FAILED';
}

// Return complete state only to the trusted protected caller for encryption.
// No CLI output, retry, credentials in arguments, or mutating SQL is provided.
export function collectNativePreimage({connection,endpoint,plan,versions,invoke=execFileSync,clock=()=>new Date().toISOString()}) {
 let stage='CONTEXT';
 try {
  assert.equal(plan.database.projectId,'eyuctbnlvnbnivwasvqr');
  assert.equal(plan.productCommit,'0d2b27144fcf589bb887e669c09e82158e3de7a2');
  assert.equal(plan.productTree,'e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0');
  assert.ok(Array.isArray(versions)&&versions.length===146);
  const env=nativeReadOnlyEnvironment({connection,endpoint,plan});
  const startedAt=clock();stage='QUERY';
  const text=invoke('psql',['--no-psqlrc','--no-password','--set','ON_ERROR_STOP=1','--tuples-only','--no-align','--quiet'],
   {env,input:NATIVE_PREIMAGE_SQL,encoding:'utf8',timeout:25000,maxBuffer:16*1024*1024,
    windowsHide:true,stdio:['pipe','pipe','pipe']});
  const finishedAt=clock();stage='OUTPUT';
  assert.equal(typeof text,'string');assert.ok(Buffer.byteLength(text)<=16*1024*1024);
  const value=JSON.parse(text);stage='VERIFY';
  const verified=verifyNativePreimage({value,plan,versions,interval:{startedAt,finishedAt},now:Date.parse(clock())});
  return {...verified,raw:value,authentication:'database-password',
   endpoint:Object.fromEntries(['projectId','hostname','port','username','database'].map(key=>[key,endpoint[key]])),
   sqlSha256:createHash('sha256').update(NATIVE_PREIMAGE_SQL).digest('hex')};
 } catch(error) {
  throw new PreimageCollectionError(stage==='QUERY'?nativeReadFailure(error):'DELIVERY_NATIVE_PREIMAGE_'+stage);
 }
}
