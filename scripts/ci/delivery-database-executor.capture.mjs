import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAdmissionContext} from './delivery-admission.mjs';
import {collectExecutor,executorFailureCode} from './delivery-database-executor.mjs';
const PRIMARY='eyuctbnlvnbnivwasvqr';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const contractBytes=readFileSync(new URL('./delivery-executor-contract.json',import.meta.url));
const contract=JSON.parse(contractBytes);
const contractSha256=hash(contractBytes);
class DatabaseCaptureError extends Error {}
export function databaseCaptureFailureCode(error){
 return error instanceof DatabaseCaptureError?error.message:'DELIVERY_DATABASE_EXECUTOR_CAPTURE_FAILED';
}
export function validateDatabaseCaptureContext(env){
 validateAdmissionContext(env);
 assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(env.DELIVERY_EXECUTOR_SCOPE,'PRIMARY_READ_ONLY_EXECUTOR');
 assert.match(env.GITHUB_RUN_ATTEMPT??'',/^[1-9][0-9]*$/);
 return {controlCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT)};
}
export function validatePrimaryEndpoint(project,poolers){
 assert.equal(project?.id,PRIMARY);assert.equal(project.status,'ACTIVE_HEALTHY');
 assert.equal(project.region,'ap-northeast-1');assert.equal(project.database?.host,'db.'+PRIMARY+'.supabase.co');
 assert.ok(Array.isArray(poolers)&&poolers.length>0&&poolers.length<=10);
 const primary=poolers.filter(p=>p.database_type==='PRIMARY');assert.equal(primary.length,1);
 const raw=primary[0].connection_string;assert.ok(typeof raw==='string'&&raw.length<65536&&!/[\x00-\x1f\x7f]/.test(raw));
 const u=new URL(raw);assert.ok(['postgres:','postgresql:'].includes(u.protocol));
 assert.ok(/^aws-[0-9]+-ap-northeast-1\.pooler\.supabase\.com$/.test(u.hostname));
 assert.equal(decodeURIComponent(u.username),'postgres.'+PRIMARY);assert.equal(u.pathname,'/postgres');
 assert.ok(['5432','6543'].includes(u.port));assert.equal(u.hash,'');
 for(const [key,value]of u.searchParams){assert.equal(key,'sslmode');assert.ok(['require','verify-full'].includes(value));assert.equal(u.searchParams.getAll(key).length,1);}
 return {projectId:PRIMARY,hostname:u.hostname,port:'5432',username:'postgres.'+PRIMARY,database:'postgres'};
}
async function managementGet(path,token,fetchImpl){
 assert.ok(['/v1/projects/'+PRIMARY,'/v1/projects/'+PRIMARY+'/config/database/pooler'].includes(path));
 try{
  const response=await fetchImpl('https://api.supabase.com'+path,{method:'GET',redirect:'error',headers:{Authorization:'Bearer '+token,Accept:'application/json'},signal:AbortSignal.timeout(15000)});
  assert.equal(response.status,200);assert.ok(response.body);
  const chunks=[];let total=0;
  for await(const chunk of response.body){total+=chunk.length;assert.ok(total<=131072);chunks.push(Buffer.from(chunk));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch{throw new Error('DELIVERY_DATABASE_PROVIDER_READ_FAILED');}
}
export async function captureDatabaseExecutor({env,token,password,fetchImpl=fetch,collect=collectExecutor,now=()=>new Date().toISOString()}){
 let stage='CONTEXT';
 try{
 const provenance=validateDatabaseCaptureContext(env);const requestStartedAt=now();
 stage='SOURCE';
 const sources={collectorSha256:hash(readFileSync(new URL('./delivery-database-executor.mjs',import.meta.url))),sqlSha256:hash(readFileSync(new URL('./delivery-database-executor.sql',import.meta.url)))};
 stage='CREDENTIAL_INPUT';
 assert.match(token??'',/^sbp_[a-f0-9]{40}$/);
 assert.ok(typeof password==='string'&&password.length>0&&password.length<=4096&&!/[\x00-\x1f\x7f]/.test(password),'DELIVERY_DATABASE_PASSWORD_INVALID');
 assert.equal(contract.database.projectId,PRIMARY);assert.equal(contract.database.executor.authentication,'database-password');
 const readEndpoint=async(prefix='')=>{stage=prefix+'PROVIDER_READ';const [project,poolers]=await Promise.all([managementGet('/v1/projects/'+PRIMARY,token,fetchImpl),managementGet('/v1/projects/'+PRIMARY+'/config/database/pooler',token,fetchImpl)]);stage=prefix+'ENDPOINT';return validatePrimaryEndpoint(project,poolers);};
 const endpoint=await readEndpoint();
 stage='CONNECTION';
 const u=new URL('postgresql://placeholder.invalid');u.hostname=endpoint.hostname;u.port=endpoint.port;u.username=endpoint.username;u.password=encodeURIComponent(password);u.pathname='/postgres';u.searchParams.set('sslmode','require');u.searchParams.set('connect_timeout','10');
 stage='COLLECTOR';
 const collected=collect({connection:u.href,endpoint,plan:contract});
 const readbackStartedAt=now();const refreshed=await readEndpoint('READBACK_');assert.deepEqual(refreshed,endpoint);
 stage='SOURCE_READBACK';
 assert.equal(hash(readFileSync(new URL('./delivery-database-executor.mjs',import.meta.url))),sources.collectorSha256);
 assert.equal(hash(readFileSync(new URL('./delivery-database-executor.sql',import.meta.url))),sources.sqlSha256);
 assert.equal(hash(readFileSync(new URL('./delivery-executor-contract.json',import.meta.url))),contractSha256);
 const finishedAt=now();
 stage='TIMING';
 const times=[requestStartedAt,collected.requestStartedAt,collected.executor.observedAt,collected.requestFinishedAt,readbackStartedAt,finishedAt].map(value=>{assert.match(value??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);const time=Date.parse(value);assert.ok(Number.isFinite(time)&&new Date(time).toISOString()===value);return time;});
 assert.ok(times.every((value,i)=>i===0||times[i-1]<=value));
 assert.ok(times.at(-1)-times[0]<=90000);
 return {event:'delivery-database-executor-capture',schema:'stallorder-delivery-password-executor-capture/v1',...provenance,productCommit:contract.productCommit,productTree:contract.productTree,contractSha256,
  ...sources,
  requestStartedAt,providerReadbackStartedAt:readbackStartedAt,finishedAt,authentication:'database-password',endpoint,receipt:collected,releaseAuthorized:false};
 }catch(error){throw new DatabaseCaptureError(executorFailureCode(error)??'DELIVERY_DATABASE_CAPTURE_'+stage);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  assert.equal(process.env.DELIVERY_EXECUTOR_CONTRACT_SHA256,contractSha256);
  const receipt=await captureDatabaseExecutor({env:process.env,token:process.env.SUPABASE_ACCESS_TOKEN,password:process.env.SUPABASE_DB_PASSWORD});
  console.log(JSON.stringify(receipt));
 }catch(error){console.error(JSON.stringify({event:'delivery-database-executor-capture-failed',reason:databaseCaptureFailureCode(error),releaseAuthorized:false}));process.exitCode=1;}
}
