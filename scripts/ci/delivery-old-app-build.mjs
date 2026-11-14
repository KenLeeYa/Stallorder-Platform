import assert from 'node:assert/strict';
import {createHash,createHmac} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,mkdirSync,writeFileSync,appendFileSync} from 'node:fs';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {OLD_APP_SOURCE,verifyOldAppSource,verifyOldAppPreview} from './delivery-old-app-preview.mjs';
import {verifyPreviewConfiguration,verifyExistingPreview,PREVIEW_BINDING} from './delivery-preview-binding.mjs';
import {credentialRequest} from './delivery-credential-preview.mjs';
import {verifyPreviewVercelAccess} from './delivery-preview-vercel-access.mjs';

const project='prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP',team='team_MMfsiG94K9Zy3e6w7Ccc9xY4';
const secrets=['ABUSE_HASH_SECRET','TOKEN_DERIVATION_SECRET','AUDIT_IP_HASH_SECRET','SESSION_FINGERPRINT_HASH_SECRET',
 'OAUTH_STATE_SECRET','DELIVERY_MOCK_WEBHOOK_SECRET','OFFLINE_PERMIT_SIGNING_SECRET','CRON_SECRET','CRON_API_SECRET'];
const fixed={VERCEL_GIT_COMMIT_SHA:OLD_APP_SOURCE.commit,NEXT_PUBLIC_SUPABASE_URL:'https://'+PREVIEW_BINDING.project+'.supabase.co',
 NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL:'https://'+PREVIEW_BINDING.project+'.supabase.co/functions/v1',
 // The Origin header uses the existing canonical allowlist; the destination is fixed to Preview above.
 SUPABASE_FUNCTIONS_URL:'https://'+PREVIEW_BINDING.project+'.supabase.co/functions/v1',PUBLIC_ORDER_FUNCTION_ORIGIN:'https://app.qidaigo.com',NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3000',
 NEXT_PUBLIC_TURNSTILE_SITE_KEY:'1x00000000000000000000AA',OAUTH_PROVIDER_MODE:'mock',BACKEND_ACTIVE_TARGET:'PRIMARY',AUTH_PROJECT_CODE:'PRIMARY',
 PRODUCTION_ENVIRONMENT_APPROVED:'false',CATALOG_TRANSLATION_ENABLED:'false',REPORT_DELIVERY_MODE:'simulate',ALLOW_DEMO_SEED:'true',
 TRUSTED_CLIENT_IP_HEADER:'x-real-ip',OAUTH_MOCK_GOOGLE_SUBJECT:'preview-google-subject',OAUTH_MOCK_LINE_SUBJECT:'preview-line-subject',OAUTH_MOCK_APPLE_SUBJECT:'preview-apple-subject'};
export const OLD_APP_ENV_NAMES=Object.freeze(['DATABASE_URL','DIRECT_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',...Object.keys(fixed),...secrets]);

export function oldAppFixtureIdentity(raw,phase){
 try{
  assert.ok(['baseline','cutover','recovery','restore'].includes(phase));assert.ok(typeof raw==='string'&&Buffer.byteLength(raw)<=2048);
  const v=JSON.parse(raw);assert.deepEqual(Object.keys(v).sort(),['note','phase','profiles','qrId']);assert.equal(v.phase,phase);
  assert.ok(Array.isArray(v.profiles)&&v.profiles.length===2);
  for(const id of [...v.profiles,v.qrId])assert.match(id,/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.equal(new Set([...v.profiles,v.qrId]).size,3);
  assert.match(v.note,/^Credential rehearsal [1-9][0-9]* [a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);return v;
 }catch{throw new Error('OLD_APP_FIXTURE_IDENTITY_REJECTED');}
}

export function oldAppRehearsalDeployment(binding,deployment,phase){
 try{assert.ok(['baseline','cutover','recovery'].includes(phase));assert.equal(deployment.meta?.stallorderCompatibilityPhase,phase);
  return {...verifyOldAppPreview({binding,deployment}),rehearsalPhase:phase};
 }catch{throw new Error('OLD_APP_REHEARSAL_DEPLOYMENT_REJECTED');}
}

export function oldAppConfiguration(config,password,seed){
 try{
  verifyPreviewConfiguration(config);assert.ok(typeof password==='string'&&password.length>=16&&password.length<=4096&&!/[\x00-\x1f\x7f]/.test(password));
  assert.match(seed??'',/^[a-f0-9]{64}$/);
  const parsed=new URL(config.POSTGRES_URL);assert.match(parsed.hostname,/^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$/);
  const url=port=>{
   const value=new URL(`postgresql://${parsed.hostname}:${port}/postgres`);
   value.username='postgres.'+PREVIEW_BINDING.project;value.password=encodeURIComponent(password);
   value.searchParams.set('sslmode','require');value.searchParams.set('connect_timeout','10');if(port===6543)value.searchParams.set('pgbouncer','true');
   return value.toString();
  };
  return {...fixed,DATABASE_URL:url(6543),DIRECT_URL:url(5432),NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:config.SUPABASE_ANON_KEY,
   ...Object.fromEntries(secrets.map(name=>[name,createHmac('sha256',Buffer.from(seed,'hex')).update('old-app-preview/v1/'+name).digest('hex')]))};
 }catch{throw new Error('OLD_APP_CONFIGURATION_REJECTED');}
}

function coldAuthentication(config){
 for(const field of ['DIRECT_URL','DATABASE_URL']){
  const url=new URL(config[field]);
  const env={PATH:process.env.PATH,LANG:'C.UTF-8',PGHOST:url.hostname,PGPORT:url.port,PGUSER:decodeURIComponent(url.username),
   PGPASSWORD:decodeURIComponent(url.password),PGDATABASE:'postgres',PGSSLMODE:'require',PGCONNECT_TIMEOUT:'10'};
  const sql="BEGIN READ ONLY; SET LOCAL statement_timeout='5s'; SELECT current_user||'|'||session_user||'|'||current_database()||'|'||current_setting('transaction_read_only')||'|'||(SELECT rolbypassrls FROM pg_roles WHERE rolname=current_user); ROLLBACK;";
  const out=execFileSync('psql',['-X','-qAt','-v','ON_ERROR_STOP=1'],{env,input:sql,encoding:'utf8',timeout:20000,maxBuffer:32768,stdio:['pipe','pipe','pipe']});
  assert.equal(out.trim(),'postgres|postgres|postgres|on|true');
 }
}

export function verifyOldAppBuildContext(env){
 try{
  for(const [key,value] of Object.entries({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',
   GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ATTEMPT:'1',
   GITHUB_JOB:'qualify',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',
   GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/delivery-old-app-preview.yml@refs/heads/main'}))assert.equal(env[key],value);
  assert.match(env.RUNNER_NAME??'',/^GitHub Actions \d+$/);assert.match(env.GITHUB_SHA??'',/^[a-f0-9]{40}$/);assert.match(env.GITHUB_RUN_ID??'',/^[1-9][0-9]*$/);
 }catch{throw new Error('OLD_APP_BUILD_CONTEXT_REJECTED');}
}

export function oldAppBuildArguments(env){
 try{
  verifyOldAppBuildContext(env);assert.equal(env.VERCEL_PROJECT_ID,project);assert.equal(env.VERCEL_ORG_ID,team);
  assert.ok(['baseline','cutover','recovery','restore'].includes(env.REHEARSAL_PHASE));
  for(const [key,value] of Object.entries(fixed))assert.equal(env[key],value);
  for(const name of OLD_APP_ENV_NAMES)assert.ok(typeof env[name]==='string'&&env[name].length>0&&env[name].length<=8192&&!/[\x00-\x1f\x7f]/.test(env[name]));
  for(const name of secrets)assert.ok(env[name].length>=32);
  for(const field of ['DATABASE_URL','DIRECT_URL'])verifyPreviewConfiguration({POSTGRES_URL:env[field],SUPABASE_URL:env.NEXT_PUBLIC_SUPABASE_URL,SUPABASE_ANON_KEY:env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY});
  const runtime=new URL(env.DATABASE_URL),direct=new URL(env.DIRECT_URL);
  assert.equal(runtime.port,'6543');assert.equal(runtime.searchParams.get('pgbouncer'),'true');assert.equal(direct.port,'5432');
  assert.equal(runtime.hostname,direct.hostname);assert.equal(runtime.username,direct.username);assert.equal(runtime.password,direct.password);
  const args=['--yes','vercel@58.3.0','deploy','.','--yes','--target','preview','--skip-domain','--json','--project',project];
  for(const [key,value] of Object.entries({githubCommitSha:OLD_APP_SOURCE.commit,githubCommitRef:'main',stallorderCompatibilityPurpose:'delivery-old-app',
   stallorderCompatibilityRun:env.GITHUB_RUN_ID,stallorderCompatibilityControl:env.GITHUB_SHA,stallorderCompatibilityPhase:env.REHEARSAL_PHASE,stallorderOldAppTree:OLD_APP_SOURCE.tree,
   stallorderOldAppLock:OLD_APP_SOURCE.lockfileSha256,stallorderCompatibilityDatabase:PREVIEW_BINDING.project}))args.push('--meta',key+'='+value);
  // Vercel resolves valueless environment flags from the child environment.
  // Credentials, including its authentication token, never enter argv.
  for(const name of OLD_APP_ENV_NAMES)args.push('--build-env',name,'--env',name);
  return args;
 }catch{throw new Error('OLD_APP_BUILD_CONFIGURATION_REJECTED');}
}

function sourceState(oldApp){
 const git=args=>execFileSync('git',args,{cwd:oldApp,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:1024*1024}).trim();
 const hash=path=>createHash('sha256').update(readFileSync(resolve(oldApp,path))).digest('hex');
 return verifyOldAppSource({commit:git(['rev-parse','HEAD']),tree:git(['rev-parse','HEAD^{tree}']),status:git(['status','--porcelain','--untracked-files=normal']),
  packageSha256:hash('package.json'),lockfileSha256:hash('package-lock.json')});
}

async function deploymentReceipt(binding,token,phase){
 assert.match(binding.deploymentId??'',/^dpl_[A-Za-z0-9]+$/);assert.ok(token&&token.length>=20&&!/\s/.test(token));
 const response=await fetch(`https://api.vercel.com/v13/deployments/${binding.deploymentId}?teamId=${team}`,{headers:{Authorization:'Bearer '+token},redirect:'error',signal:AbortSignal.timeout(20000)});
 assert.equal(response.status,200);const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;assert.ok(size<=2*1024*1024);chunks.push(Buffer.from(chunk));}
 return oldAppRehearsalDeployment(binding,JSON.parse(Buffer.concat(chunks).toString('utf8')),phase);
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const env=process.env,root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),oldApp=resolve(root,'../old-app');
  assert.equal(process.argv.length,3);verifyOldAppBuildContext(env);sourceState(oldApp);
  if(process.argv[2]==='source')console.log(JSON.stringify({event:'old-app-source',...OLD_APP_SOURCE,sourceVerified:true,releaseAuthorized:false}));
  else if(process.argv[2]==='configure'){
   verifyExistingPreview({parent:PREVIEW_BINDING.parent,branches:await credentialRequest('GET',`/v1/projects/${PREVIEW_BINDING.parent}/branches`,undefined,env.SUPABASE_ACCESS_TOKEN)});
   const branch=await credentialRequest('GET',`/v1/branches/${PREVIEW_BINDING.branchId}`,undefined,env.SUPABASE_ACCESS_TOKEN);
   assert.equal(branch.ref,PREVIEW_BINDING.project);assert.equal(branch.status,'ACTIVE_HEALTHY');
   await verifyPreviewVercelAccess({team:env.VERCEL_ORG_ID,project:env.VERCEL_PROJECT_ID,token:env.VERCEL_TOKEN});
   const raw=execFileSync('supabase',['branches','get',PREVIEW_BINDING.name,'--project-ref',PREVIEW_BINDING.parent,'--output','json','--log-level','error'],
    {encoding:'utf8',timeout:30000,maxBuffer:131072,stdio:['ignore','pipe','pipe']});
   const config=oldAppConfiguration(JSON.parse(raw),env.SUPABASE_DB_PASSWORD,env.OLD_APP_PREVIEW_SEED);
   oldAppBuildArguments({...env,...config});coldAuthentication(config);
   for(const [name,value] of Object.entries(config)){
    console.log('::add-mask::'+value.replaceAll('%','%25'));
    appendFileSync(env.GITHUB_ENV,`${name}=${value}\n`);
   }
   console.log(JSON.stringify({event:'old-app-preview-configured',project:PREVIEW_BINDING.project,coldAuthenticationPorts:[5432,6543],role:'postgres',applicationSecretsStable:true}));
  }
  else if(process.argv[2]==='restore'){
   assert.equal(env.REHEARSAL_PHASE,'restore');oldAppBuildArguments(env);
   const binding={controlCommit:env.GITHUB_SHA,runId:env.RESTORE_RUN_ID,deploymentId:env.RESTORE_DEPLOYMENT_ID,url:env.RESTORE_URL};
   const receipt=await deploymentReceipt(binding,env.VERCEL_TOKEN,'baseline');
   appendFileSync(env.GITHUB_OUTPUT,`deployment_id=${binding.deploymentId}\nurl=${receipt.url}\n`);
   console.log(JSON.stringify({event:'old-app-baseline-restored',...receipt,newColdAppStartVerified:false}));
  }else{
   assert.ok(['baseline','cutover','recovery'].includes(env.REHEARSAL_PHASE));
   assert.equal(process.argv[2],'deploy');const args=oldAppBuildArguments(env);assert.ok(env.VERCEL_TOKEN&&env.VERCEL_TOKEN.length>=20&&!/\s/.test(env.VERCEL_TOKEN));
   mkdirSync(resolve(oldApp,'.vercel'),{recursive:true});writeFileSync(resolve(oldApp,'.vercel/project.json'),JSON.stringify({orgId:team,projectId:project}),{flag:'wx'});
   await new Promise((ok,fail)=>process.stdout.write(JSON.stringify({event:'old-app-deploy-intent',controlCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,
    appCommit:OLD_APP_SOURCE.commit,project,team,database:PREVIEW_BINDING.project,target:'preview'})+'\n',e=>e?fail(e):ok()));
   const childEnv={};for(const name of ['PATH','HOME','TMPDIR','RUNNER_TEMP','CI','DO_NOT_TRACK','VERCEL_TOKEN','VERCEL_ORG_ID','VERCEL_PROJECT_ID',...OLD_APP_ENV_NAMES])if(env[name])childEnv[name]=env[name];
   const raw=execFileSync('npx',args,{cwd:oldApp,env:childEnv,encoding:'utf8',timeout:600000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
   const result=JSON.parse(raw),d=result.deployment??result;assert.match(d.id??'',/^dpl_[A-Za-z0-9]+$/);
   const binding={controlCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,deploymentId:d.id,url:d.url?.startsWith('https://')?d.url:'https://'+d.url};
   const receipt=await deploymentReceipt(binding,env.VERCEL_TOKEN,env.REHEARSAL_PHASE);
   sourceState(oldApp);appendFileSync(env.GITHUB_OUTPUT,`deployment_id=${binding.deploymentId}\nurl=${binding.url}\n`);
   console.log(JSON.stringify({event:'old-app-preview-built',...receipt}));
  }
 }catch{console.error('OLD_APP_PREVIEW_BUILD_FAILED');process.exitCode=1;}
}
