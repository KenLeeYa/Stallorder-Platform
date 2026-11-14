import test from 'node:test';
import assert from 'node:assert/strict';
import {oldAppBuildArguments,verifyOldAppBuildContext,OLD_APP_ENV_NAMES,oldAppConfiguration,oldAppFixtureIdentity,oldAppRehearsalDeployment} from './delivery-old-app-build.mjs';
import {OLD_APP_SOURCE} from './delivery-old-app-preview.mjs';
const context=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',
 GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'qualify',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_NAME:'GitHub Actions 1',
 GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/delivery-old-app-preview.yml@refs/heads/main'});
function environment(){
 const env={...context(),REHEARSAL_PHASE:'baseline',VERCEL_PROJECT_ID:'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP',VERCEL_ORG_ID:'team_MMfsiG94K9Zy3e6w7Ccc9xY4',
  DATABASE_URL:'postgresql://postgres.teunnvfakbfzmodajqjz:synthetic-placeholder-password@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?pgbouncer=true',
  DIRECT_URL:'postgresql://postgres.teunnvfakbfzmodajqjz:synthetic-placeholder-password@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres',
  NEXT_PUBLIC_SUPABASE_URL:'https://teunnvfakbfzmodajqjz.supabase.co',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'synthetic-placeholder-anon',
  NEXT_PUBLIC_SUPABASE_FUNCTIONS_URL:'https://teunnvfakbfzmodajqjz.supabase.co/functions/v1',
  SUPABASE_FUNCTIONS_URL:'https://teunnvfakbfzmodajqjz.supabase.co/functions/v1',PUBLIC_ORDER_FUNCTION_ORIGIN:'https://app.qidaigo.com',NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3000',
  NEXT_PUBLIC_TURNSTILE_SITE_KEY:'1x00000000000000000000AA',OAUTH_PROVIDER_MODE:'mock',BACKEND_ACTIVE_TARGET:'PRIMARY',AUTH_PROJECT_CODE:'PRIMARY',
  PRODUCTION_ENVIRONMENT_APPROVED:'false',CATALOG_TRANSLATION_ENABLED:'false',REPORT_DELIVERY_MODE:'simulate',ALLOW_DEMO_SEED:'true',
  TRUSTED_CLIENT_IP_HEADER:'x-real-ip',OAUTH_MOCK_GOOGLE_SUBJECT:'preview-google-subject',OAUTH_MOCK_LINE_SUBJECT:'preview-line-subject',OAUTH_MOCK_APPLE_SUBJECT:'preview-apple-subject',
  VERCEL_GIT_COMMIT_SHA:'4e95d2ea5d53ae78c5af9c3db044481237674c44'};
 for(const name of ['ABUSE_HASH_SECRET','TOKEN_DERIVATION_SECRET','AUDIT_IP_HASH_SECRET','SESSION_FINGERPRINT_HASH_SECRET','OAUTH_STATE_SECRET','DELIVERY_MOCK_WEBHOOK_SECRET','OFFLINE_PERMIT_SIGNING_SECRET','CRON_SECRET','CRON_API_SECRET'])env[name]='synthetic-placeholder-'+name+'-'.repeat(32);
 return env;
}
test('build arguments fix the existing Preview and exact old source without credential values',()=>{
 const env=environment(),args=oldAppBuildArguments(env);
 assert.deepEqual(args.slice(0,7),['--yes','vercel@58.3.0','deploy','.','--yes','--target','preview']);
 assert.ok(args.includes('stallorderOldAppTree=73960312807aa3de72d3b0d8e6fbbd903a8bae09'));
 assert.ok(args.includes('githubCommitSha=4e95d2ea5d53ae78c5af9c3db044481237674c44'));
 assert.ok(args.includes('stallorderCompatibilityPhase=baseline'));
 assert.ok(!args.includes('--prod')&&!args.includes('--token'));
 assert.ok(args.includes('--skip-domain'));
 for(const name of OLD_APP_ENV_NAMES){assert.equal(args.filter(v=>v===name).length,2);assert.ok(!args.some(v=>v.includes(env[name])&&env[name].includes('synthetic-placeholder')));}
 assert.equal(args.filter(v=>v==='--env').length,OLD_APP_ENV_NAMES.length);assert.equal(args.filter(v=>v==='--build-env').length,OLD_APP_ENV_NAMES.length);
});
test('only exact durable fixture identity is accepted for the requested phase',()=>{
 const a='abcdef78-1234-4123-8123-123456789012',b='abcdef78-1234-4123-8123-123456789013',c='abcdef78-1234-4123-8123-123456789014';
 const identity={phase:'baseline',profiles:[a,b],qrId:c,note:'Credential rehearsal 123 '+a};
 assert.deepEqual(oldAppFixtureIdentity(JSON.stringify(identity),'baseline'),identity);
 for(const change of [{phase:'cutover'},{profiles:[a,a]},{qrId:a},{note:"foreign'"},{extra:true}])
  assert.throws(()=>oldAppFixtureIdentity(JSON.stringify({...identity,...change}),'baseline'));
});
test('restoration must identify the original baseline, not another successful phase',()=>{
 const binding={controlCommit:'a'.repeat(40),runId:'123',deploymentId:'dpl_Test',url:'https://stallorder-platform-test-ada76145-8663s-projects.vercel.app'};
 const d={id:binding.deploymentId,projectId:'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP',ownerId:'team_MMfsiG94K9Zy3e6w7Ccc9xY4',
  url:binding.url,target:null,readyState:'READY',meta:{githubCommitSha:OLD_APP_SOURCE.commit,githubCommitRef:'main',
   stallorderCompatibilityPurpose:'delivery-old-app',stallorderCompatibilityRun:binding.runId,stallorderCompatibilityControl:binding.controlCommit,
   stallorderOldAppTree:OLD_APP_SOURCE.tree,stallorderOldAppLock:OLD_APP_SOURCE.lockfileSha256,
   stallorderCompatibilityDatabase:'teunnvfakbfzmodajqjz',stallorderCompatibilityPhase:'baseline'}};
 assert.equal(oldAppRehearsalDeployment(binding,d,'baseline').rehearsalPhase,'baseline');
 for(const phase of ['cutover','recovery',undefined])assert.throws(()=>oldAppRehearsalDeployment(binding,{...d,meta:{...d.meta,stallorderCompatibilityPhase:phase}},'baseline'));
 assert.throws(()=>oldAppRehearsalDeployment(binding,{...d,target:'production'},'baseline'));
});
for(const key of ['GITHUB_ACTOR','GITHUB_TRIGGERING_ACTOR','GITHUB_REF','GITHUB_RUN_ATTEMPT','RUNNER_ENVIRONMENT','GITHUB_WORKFLOW_REF'])test('reject invalid context '+key,()=>{
 const env=environment();env[key]='foreign';assert.throws(()=>verifyOldAppBuildContext(env));
});
for(const [key,value] of [['VERCEL_PROJECT_ID','foreign'],['VERCEL_ORG_ID','foreign'],['NEXT_PUBLIC_SUPABASE_URL','https://eyuctbnlvnbnivwasvqr.supabase.co'],
 ['SUPABASE_FUNCTIONS_URL','https://eyuctbnlvnbnivwasvqr.supabase.co/functions/v1'],['PUBLIC_ORDER_FUNCTION_ORIGIN','https://eyuctbnlvnbnivwasvqr.supabase.co'],['REHEARSAL_PHASE','foreign'],
 ['OAUTH_PROVIDER_MODE','live'],['BACKEND_ACTIVE_TARGET','DR'],['PRODUCTION_ENVIRONMENT_APPROVED','true'],['REPORT_DELIVERY_MODE','live'],['CATALOG_TRANSLATION_ENABLED','true'],['VERCEL_GIT_COMMIT_SHA','b'.repeat(40)]])test('reject wrong build target or live effects '+key,()=>{
 const env=environment();env[key]=value;assert.throws(()=>oldAppBuildArguments(env),e=>e.message==='OLD_APP_BUILD_CONFIGURATION_REJECTED');
});
test('reject missing/short secret and differing credential endpoints without exposing input',()=>{
 for(const change of [e=>delete e.CRON_SECRET,e=>e.OAUTH_STATE_SECRET='private',e=>e.DIRECT_URL=e.DATABASE_URL.replace('teunnvfakbfzmodajqjz','eyuctbnlvnbnivwasvqr')]){
  const env=environment();change(env);assert.throws(()=>oldAppBuildArguments(env),e=>e.message==='OLD_APP_BUILD_CONFIGURATION_REJECTED'&&!('actual'in e));
 }
});
test('configuration uses the GitHub password exactly and keeps application secrets stable across rotation',()=>{
 const e=environment(),config={POSTGRES_URL:e.DATABASE_URL,SUPABASE_URL:e.NEXT_PUBLIC_SUPABASE_URL,SUPABASE_ANON_KEY:e.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY};
 const a=oldAppConfiguration(config,'synthetic-placeholder-%25/+ #','a'.repeat(64));
 const b=oldAppConfiguration(config,'synthetic-placeholder-next','a'.repeat(64));
 assert.equal(decodeURIComponent(new URL(a.DATABASE_URL).password),'synthetic-placeholder-%25/+ #');
 assert.equal(new URL(a.DIRECT_URL).port,'5432');assert.equal(new URL(a.DATABASE_URL).port,'6543');
 assert.equal(a.OAUTH_STATE_SECRET,b.OAUTH_STATE_SECRET);assert.notEqual(a.DATABASE_URL,b.DATABASE_URL);
 assert.doesNotThrow(()=>oldAppBuildArguments({...e,...a}));
 for(const password of ['', 'bad\nvalue'])assert.throws(()=>oldAppConfiguration(config,password,'a'.repeat(64)),/^Error: OLD_APP_CONFIGURATION_REJECTED$/);
 assert.throws(()=>oldAppConfiguration(config,'synthetic-placeholder-password','short'));
 assert.throws(()=>oldAppConfiguration({...config,SUPABASE_URL:'https://eyuctbnlvnbnivwasvqr.supabase.co'},'synthetic-placeholder-password','a'.repeat(64)));
});
