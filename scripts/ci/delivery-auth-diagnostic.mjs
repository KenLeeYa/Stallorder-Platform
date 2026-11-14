import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {managementGet,validatePrimaryEndpoint} from './delivery-database-executor.capture.mjs';
import {nativeReadFailure} from './delivery-native-read-connection.mjs';

const project='eyuctbnlvnbnivwasvqr',repository='KenLeeYa/Stallorder-Platform';
const workflow='.github/workflows/production-delivery-auth-diagnostic.yml';
const sql="BEGIN READ ONLY;\nSET LOCAL statement_timeout = '5s';\nSET LOCAL lock_timeout = '1s';\n"+
 "SELECT pg_catalog.json_build_object('currentUser',current_user,'sessionUser',session_user,'database',current_database(),"+
 "'readOnly',current_setting('transaction_read_only'));\nROLLBACK;\n";
const statuses=['authenticated-read-only','DELIVERY_EXECUTOR_AUTH_REJECTED','DELIVERY_EXECUTOR_CONNECTION_FAILED',
 'DELIVERY_EXECUTOR_PERMISSION_REJECTED','DELIVERY_EXECUTOR_STARTUP_REJECTED','DELIVERY_EXECUTOR_QUERY_FAILED'];
function passwordInput(password) {
 assert.ok(typeof password==='string'&&password.length>0&&password.length<=4096&&!/[\x00-\x1f\x7f]/.test(password));
}
// Diagnostic only. This SQL has no privilege/migration qualification and cannot
// replace the session-pooler executor capture. Each call attempts one connection.
export function probeNativeAuthentication({mode,hostname,port,username,password,execute=execFileSync,processEnv=process.env}) {
 try {
  passwordInput(password);
  if(mode==='direct')assert.deepEqual({hostname,port,username},{hostname:`db.${project}.supabase.co`,port:'5432',username:'postgres'});
  else {
   assert.equal(mode,'transaction');assert.match(hostname,/^aws-[0-9]+-ap-northeast-1\.pooler\.supabase\.com$/);
   assert.equal(port,'6543');assert.equal(username,'postgres.'+project);
  }
  const env={PATH:processEnv.PATH,LANG:'C.UTF-8',TZ:'UTC',PGHOST:hostname,PGPORT:port,PGUSER:username,
   PGPASSWORD:password,PGDATABASE:'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10',PGAPPNAME:'stallorder-readonly-auth-diagnostic'};
  const raw=execute('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:20000,
   maxBuffer:32768,stdio:['pipe','pipe','pipe']});
  assert.ok(typeof raw==='string'&&Buffer.byteLength(raw)<=32768);
  assert.deepEqual(JSON.parse(raw.trim()),{currentUser:'postgres',sessionUser:'postgres',database:'postgres',readOnly:'on'});
  return {status:'authenticated-read-only'};
 } catch(error) {return {status:nativeReadFailure(error)};}
}
function context(env) {
 for(const [key,value] of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:repository,GITHUB_REPOSITORY_OWNER:'KenLeeYa',
  GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
  GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'diagnose',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
  GITHUB_WORKFLOW_REF:repository+'/'+workflow+'@refs/heads/main'}))assert.equal(env[key],value);
 assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
 assert.match(env.RUNNER_NAME??'',/^GitHub Actions \d+$/);
 return {controlCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:1};
}
function sources() {
 return Object.fromEntries([workflow,'scripts/ci/delivery-auth-diagnostic.mjs','scripts/ci/delivery-native-read-connection.mjs',
  'scripts/ci/delivery-database-executor.capture.mjs'].map(path=>[path,createHash('sha256').update(
  readFileSync(new URL('../../'+path,import.meta.url))).digest('hex')]));
}
export async function runAuthDiagnostic({env,token,password,fetchImpl=fetch,probe=probeNativeAuthentication,clock=()=>new Date().toISOString()}) {
 let stage='CONTEXT';
 try {
  const provenance=context(env),startedAt=clock(),sourceDigests=sources();
  stage='INPUT';assert.match(token??'',/^sbp_[a-f0-9]{40}$/);passwordInput(password);
  const endpoint=async()=>{const [p,poolers]=await Promise.all([
   managementGet('/v1/projects/'+project,token,fetchImpl),managementGet('/v1/projects/'+project+'/config/database/pooler',token,fetchImpl)]);
   return validatePrimaryEndpoint(p,poolers);};
  stage='PROVIDER';const original=await endpoint();
  stage='PROBE';const probes=[];
  const once=mode=>{
   const target=mode==='direct'?{hostname:`db.${project}.supabase.co`,port:'5432',username:'postgres'}:
    {hostname:original.hostname,port:'6543',username:original.username};
   const result=probe({mode,...target,password});assert.deepEqual(Object.keys(result),['status']);assert.ok(statuses.includes(result.status));
   probes.push({mode,...target,status:result.status});return result.status;
  };
  const direct=once('direct');
  // Do not add another attempt after an explicit direct auth/permission/query
  // failure. A network-unreachable direct host leaves authentication unknown.
  if(['authenticated-read-only','DELIVERY_EXECUTOR_CONNECTION_FAILED'].includes(direct))once('transaction');
  stage='READBACK';assert.deepEqual(await endpoint(),original);assert.deepEqual(sources(),sourceDigests);
  stage='TIMING';const finishedAt=clock(),start=Date.parse(startedAt),finish=Date.parse(finishedAt);
  for(const value of [startedAt,finishedAt])assert.equal(new Date(value).toISOString(),value);
  assert.ok(start<=finish&&finish-start<=150000);
  return {event:'delivery-auth-diagnostic',schema:'stallorder-delivery-auth-diagnostic/v1',project,...provenance,
   sourceDigests,startedAt,finishedAt,probes,executorQualified:false,mutationAuthorized:false,releaseAuthorized:false};
 } catch {throw new Error('DELIVERY_AUTH_DIAGNOSTIC_'+stage);}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {console.log(JSON.stringify(await runAuthDiagnostic({env:process.env,token:process.env.SUPABASE_ACCESS_TOKEN,password:process.env.SUPABASE_DB_PASSWORD})));}
 catch(error){console.error(JSON.stringify({event:'delivery-auth-diagnostic-failed',reason:error.message,releaseAuthorized:false}));process.exitCode=1;}
}
