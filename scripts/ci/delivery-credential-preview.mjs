import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {PREVIEW_BINDING,verifyExistingPreview} from './delivery-preview-binding.mjs';

const project=PREVIEW_BINDING.project,parent=PREVIEW_BINDING.parent;
const prefix='/v1/projects/'+project;
const inventory="SELECT rolname FROM pg_roles WHERE rolname LIKE 'cli_login_%' ORDER BY rolname;";
const validRole=value=>typeof value==='string'&&/^cli_login_[a-z0-9_]{1,45}$/.test(value);
const sql="BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='1s'; "+
 "SELECT json_build_object('currentUser',current_user,'sessionUser',session_user,'database',current_database(),"+
 "'readOnly',current_setting('transaction_read_only'),'bypassRls',(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user)); ROLLBACK;";

export async function credentialRequest(method,path,body,token,fetchImpl=fetch){
 try{
  const get=method==='GET'&&body===undefined&&[prefix,prefix+'/config/database/pooler',`/v1/projects/${parent}/branches`].includes(path);
  const issue=method==='POST'&&path===prefix+'/cli/login-role'&&JSON.stringify(body)==='{"read_only":false}';
  const cleanup=method==='DELETE'&&path===prefix+'/cli/login-role'&&body===undefined;
  const query=method==='POST'&&path===prefix+'/database/query'&&body&&Object.keys(body).length===1&&
   body.query===inventory;
  assert.ok(get||issue||cleanup||query);
  const response=await fetchImpl('https://api.supabase.com'+path,{method,redirect:'error',
   headers:{Authorization:'Bearer '+token,Accept:'application/json',...(body?{'Content-Type':'application/json'}:{})},
   ...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(20000)});
  assert.equal(response.status,issue?201:200);assert.ok(response.body);
  const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;assert.ok(size<=131072);chunks.push(Buffer.from(chunk));}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
 }catch{throw new Error('CREDENTIAL_PROVIDER_REQUEST_FAILED');}
}

export function probeCredential({hostname,role,password,execute=execFileSync}){
 assert.match(hostname,/^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$/);assert.ok(validRole(role));
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',TZ:'UTC',PGHOST:hostname,PGPORT:'6543',PGUSER:role+'.'+project,
  PGPASSWORD:password,PGDATABASE:'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10',PGAPPNAME:'stallorder-isolated-credential-probe'};
 const raw=execute('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:20000,maxBuffer:32768,stdio:['pipe','pipe','pipe']});
 const value=JSON.parse(raw.trim());assert.deepEqual(Object.keys(value).sort(),['bypassRls','currentUser','database','readOnly','sessionUser']);
 assert.ok([role,'postgres'].includes(value.currentUser));assert.equal(value.sessionUser,role);
 assert.equal(value.database,'postgres');assert.equal(value.readOnly,'on');assert.equal(typeof value.bypassRls,'boolean');
 return value;
}

function invocation(env){
 for(const [key,value] of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',
  GITHUB_REPOSITORY_OWNER:'KenLeeYa',GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',
  GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'qualify',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
  GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/delivery-credential-preview.yml@refs/heads/main'}))assert.equal(env[key],value);
 assert.match(env.RUNNER_NAME??'',/^GitHub Actions \d+$/);assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
}

// Capability qualification only. No Vercel call, Primary write, password reset,
// reusable credential export or role privilege changes are supported here.
export async function runCredentialPreview({env,request,probe=probeCredential,record=()=>{},clock=()=>new Date().toISOString()}){
 let stage='CONTEXT',role,ttlSeconds,native,issued=false,cleanupVerified=false,cleanupRequestFailed=false,reason;
 const startedAt=clock();
 try{
  invocation(env);stage='BINDING';
  const branches=await request('GET',`/v1/projects/${parent}/branches`);
  verifyExistingPreview({parent,branches});
  const p=await request('GET',prefix);assert.equal(p.id,project);assert.equal(p.status,'ACTIVE_HEALTHY');
  assert.equal(p.region,'ap-southeast-1');assert.equal(p.database?.host,'db.'+project+'.supabase.co');
  const poolers=await request('GET',prefix+'/config/database/pooler');assert.ok(Array.isArray(poolers)&&poolers.length<=10);
  const matching=poolers.filter(p=>p.database_type==='PRIMARY');assert.equal(matching.length,1);
  const url=new URL(matching[0].connection_string);assert.ok(['postgres:','postgresql:'].includes(url.protocol));
  assert.match(url.hostname,/^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$/);assert.equal(decodeURIComponent(url.username),'postgres.'+project);
  assert.equal(url.pathname,'/postgres');assert.ok(['5432','6543'].includes(url.port));assert.equal(url.hash,'');
  stage='INVENTORY';assert.deepEqual(await request('POST',prefix+'/database/query',{query:inventory}),[]);
  await record({event:'credential-preview-intent',project,controlCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,startedAt});
  stage='ISSUE';issued=true;const secret=await request('POST',prefix+'/cli/login-role',{read_only:false});
  // A returned, strictly named role can qualify for cleanup even if the rest is invalid.
  if(validRole(secret?.role))role=secret.role;
  stage='CREDENTIAL';assert.ok(role);assert.deepEqual(Object.keys(secret).sort(),['password','role','ttl_seconds']);
  assert.ok(Number.isSafeInteger(secret.ttl_seconds)&&secret.ttl_seconds>0);ttlSeconds=secret.ttl_seconds;
  assert.ok(typeof secret.password==='string'&&secret.password.length>=32&&secret.password.length<=4096&&!/[\x00-\x1f\x7f]/.test(secret.password));
  await record({event:'credential-preview-issued',project,role,ttlSeconds});
  stage='NATIVE';native=probe({hostname:url.hostname,role,password:secret.password});
 }catch{reason=stage;}
 finally{
  if(role){
   try{
    // The managed endpoint deletes all CLI roles. This fixed isolated project
    // requires one writer and exactly the role returned by this run before use.
    assert.deepEqual(await request('POST',prefix+'/database/query',{query:inventory}),[{rolname:role}]);
    assert.deepEqual(await request('DELETE',prefix+'/cli/login-role'),{message:'ok'});
   }catch{cleanupRequestFailed=true;}
   try{assert.deepEqual(await request('POST',prefix+'/database/query',{query:inventory}),[]);cleanupVerified=true;}catch{cleanupVerified=false;}
  }
 }
 return {event:'credential-preview-result',schema:'stallorder-credential-preview/v1',project,
  controlCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,startedAt,finishedAt:clock(),
  status:!reason&&cleanupVerified&&!cleanupRequestFailed?'passed':'failed',...(reason?{reason}:{}),role,ttlSeconds,native,
  cleanupVerified,cleanupRequestFailed,unresolvedIssuance:issued&&!role,primaryChanged:false,
  rotationQualified:false,releaseAuthorized:false};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const token=process.env.SUPABASE_ACCESS_TOKEN;assert.match(token??'',/^sbp_[a-f0-9]{40}$/);
  const result=await runCredentialPreview({env:process.env,request:(m,p,b)=>credentialRequest(m,p,b,token),
   record:value=>new Promise((ok,fail)=>process.stdout.write(JSON.stringify(value)+'\n',error=>error?fail(error):ok()))});
  console.log(JSON.stringify(result));if(result.status!=='passed')process.exitCode=1;
 }catch{console.error('CREDENTIAL_PREVIEW_FAILED');process.exitCode=1;}
}
