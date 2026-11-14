import test from 'node:test';
import assert from 'node:assert/strict';
import {runCredentialPreview,probeCredential,credentialRequest} from './delivery-credential-preview.mjs';
const project='teunnvfakbfzmodajqjz',parent='eyuctbnlvnbnivwasvqr';
const role='cli_login_postgres',password='synthetic-placeholder-password-credential';
const context=()=>({GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_REPOSITORY_OWNER:'KenLeeYa',
 GITHUB_ACTOR:'KenLeeYa',GITHUB_TRIGGERING_ACTOR:'KenLeeYa',GITHUB_REF:'refs/heads/main',GITHUB_EVENT_NAME:'workflow_dispatch',
 GITHUB_RUN_ATTEMPT:'1',GITHUB_JOB:'qualify',RUNNER_ENVIRONMENT:'github-hosted',RUNNER_OS:'Linux',RUNNER_NAME:'GitHub Actions 1',
 GITHUB_SHA:'a'.repeat(40),GITHUB_RUN_ID:'123',GITHUB_WORKFLOW_REF:'KenLeeYa/Stallorder-Platform/.github/workflows/delivery-credential-preview.yml@refs/heads/main'});
function fixture(){
 let issued=false;const calls=[];
 const request=async(method,path,body)=>{
  calls.push({method,path,body});
  if(path.endsWith('/branches'))return [{id:'e232885a-7d2e-4254-91f9-3a1edf9625e2',name:'pr-389-oauth-delivery',project_ref:project,
   parent_project_ref:parent,git_branch:'codex/conversion-source-checks-20261023',is_default:false,persistent:false,with_data:false,
   preview_project_status:'ACTIVE_HEALTHY',status:'MIGRATIONS_FAILED'}];
  if(path===`/v1/projects/${project}`)return {id:project,status:'ACTIVE_HEALTHY',region:'ap-southeast-1',database:{host:`db.${project}.supabase.co`}};
  if(path.endsWith('/pooler'))return [{database_type:'PRIMARY',connection_string:`postgresql://postgres.${project}:synthetic-placeholder@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres`}];
  if(method==='POST'&&path.endsWith('/cli/login-role')){issued=true;return {role,password,ttl_seconds:3600};}
  if(method==='DELETE'&&path.endsWith('/cli/login-role')){issued=false;return {message:'ok'};}
  if(body?.query?.startsWith('DROP ROLE'))throw new Error('permission denied to drop role');
  if(path.endsWith('/database/query'))return issued?[{rolname:role}]:[];
  throw new Error('unexpected request');
 };
 return {request,calls,probe:()=>({currentUser:'postgres',sessionUser:role,database:'postgres',readOnly:'on',bypassRls:true})};
}
test('bounded Preview issuance, native read-only identity and exact cleanup never grant release',async()=>{
 const f=fixture();const out=await runCredentialPreview({env:context(),...f});
 assert.equal(out.status,'passed');assert.equal(out.cleanupVerified,true);assert.equal(out.primaryChanged,false);
 assert.equal(out.rotationQualified,false);assert.equal(out.releaseAuthorized,false);assert.ok(!JSON.stringify(out).includes(password));
 assert.equal(f.calls.filter(c=>c.method==='POST'&&c.path.endsWith('/cli/login-role')).length,1);
 const deletes=f.calls.filter(c=>c.method==='DELETE');
 assert.deepEqual(deletes,[{method:'DELETE',path:`/v1/projects/${project}/cli/login-role`,body:undefined}]);
 assert.ok(!f.calls.some(c=>c.body?.query?.startsWith('DROP ROLE')));
});
for(const key of ['GITHUB_ACTOR','GITHUB_REF','GITHUB_RUN_ATTEMPT','RUNNER_ENVIRONMENT'])test('reject '+key+' before provider access',async()=>{
 const f=fixture(),env=context();env[key]='foreign';const out=await runCredentialPreview({env,...f});
 assert.equal(out.status,'failed');assert.equal(f.calls.length,0);
});
test('existing CLI roles block issuance and deletion',async()=>{
 const f=fixture(),request=f.request;f.request=(m,p,b)=>p.endsWith('/database/query')?Promise.resolve([{rolname:'cli_login_existing'}]):request(m,p,b);
 const out=await runCredentialPreview({env:context(),...f});assert.equal(out.reason,'INVENTORY');
 assert.ok(!f.calls.some(c=>c.path.endsWith('/cli/login-role')));assert.equal(out.cleanupVerified,false);
});
test('unresolved issuance is not retried or guessed for deletion even when the role was created',async()=>{
 const f=fixture(),request=f.request;let attempts=0;f.request=async(m,p,b)=>{
  const result=await request(m,p,b);if(p.endsWith('/cli/login-role')){attempts++;throw new Error(password);}return result;
 };
 const out=await runCredentialPreview({env:context(),...f});assert.equal(attempts,1);assert.equal(out.unresolvedIssuance,true);
 assert.ok(!JSON.stringify(out).includes(password));assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});
for(const value of [true,0,-1,'3600'])test('invalid TTL is rejected and returned owned role is cleaned: '+value,async()=>{
 const f=fixture(),request=f.request;f.request=async(m,p,b)=>{const r=await request(m,p,b);return m==='POST'&&p.endsWith('/cli/login-role')?{...r,ttl_seconds:value}:r;};
 const out=await runCredentialPreview({env:context(),...f});assert.equal(out.status,'failed');assert.equal(out.reason,'CREDENTIAL');assert.equal(out.cleanupVerified,true);
});
test('native rejection still cleans exact issued role and redacts details',async()=>{
 const f=fixture();f.probe=()=>{throw new Error(password);};const out=await runCredentialPreview({env:context(),...f});
 assert.equal(out.reason,'NATIVE');assert.equal(out.cleanupVerified,true);assert.ok(!JSON.stringify(out).includes(password));
});
test('unexpected role never authorizes deletion',async()=>{
 const f=fixture(),request=f.request;f.request=async(m,p,b)=>{const r=await request(m,p,b);return p.endsWith('/cli/login-role')?{...r,role:'postgres'}:r;};
 const out=await runCredentialPreview({env:context(),...f});assert.equal(out.status,'failed');assert.equal(out.unresolvedIssuance,true);
 assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});
test('failed cleanup cannot pass and never retries deletion',async()=>{
 const f=fixture(),request=f.request;let deletes=0;f.request=(m,p,b)=>{if(m==='DELETE'){deletes++;throw new Error(password);}return request(m,p,b);};
 const out=await runCredentialPreview({env:context(),...f});assert.equal(out.status,'failed');assert.equal(out.cleanupVerified,false);assert.equal(deletes,1);
});

for(const inventory of [[{rolname:role},{rolname:'cli_login_foreign'}],[{rolname:'cli_login_foreign'}],[],[{rolname:role},{rolname:role}],null,[{rolname:role,unexpected:true}]])test('changed inventory before cleanup refuses project-wide deletion: '+JSON.stringify(inventory),async()=>{
 const f=fixture(),request=f.request;let reads=0;
 f.request=(m,p,b)=>p.endsWith('/database/query')&&++reads>1?Promise.resolve(inventory):request(m,p,b);
 const out=await runCredentialPreview({env:context(),...f});
 assert.equal(out.status,'failed');assert.equal(out.cleanupRequestFailed,true);assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});

test('cleanup inventory read failure prevents DELETE',async()=>{
 const f=fixture(),request=f.request;let reads=0;
 f.request=(m,p,b)=>{if(p.endsWith('/database/query')&&++reads>1)throw new Error(password);return request(m,p,b);};
 const out=await runCredentialPreview({env:context(),...f});
 assert.equal(out.status,'failed');assert.equal(out.cleanupVerified,false);assert.ok(!f.calls.some(c=>c.method==='DELETE'));
});

test('successful DELETE response cannot pass with retained roles',async()=>{
 const f=fixture(),request=f.request;let deletes=0;
 f.request=(m,p,b)=>{if(m==='DELETE'){deletes++;return {message:'ok'};}return request(m,p,b);};
 const out=await runCredentialPreview({env:context(),...f});assert.equal(deletes,1);
 assert.equal(out.status,'failed');assert.equal(out.cleanupVerified,false);
});

test('ambiguous deletion remains failed even when readback confirms empty inventory',async()=>{
 const f=fixture(),request=f.request;let deletes=0;
 f.request=async(m,p,b)=>{const r=await request(m,p,b);if(m==='DELETE'){deletes++;throw new Error(password);}return r;};
 const out=await runCredentialPreview({env:context(),...f});
 assert.equal(out.status,'failed');assert.equal(out.cleanupVerified,true);assert.equal(out.cleanupRequestFailed,true);assert.equal(deletes,1);
 assert.ok(!JSON.stringify(out).includes(password));
});

test('HTTP adapter permits only bodyless fixed Preview managed-role cleanup',async()=>{
 let calls=0;
 const fetchImpl=async(url,opts)=>{calls++;assert.equal(url,`https://api.supabase.com/v1/projects/${project}/cli/login-role`);
  assert.equal(opts.method,'DELETE');assert.equal(opts.body,undefined);return new Response(JSON.stringify({message:'ok'}),{status:200});};
 assert.deepEqual(await credentialRequest('DELETE',`/v1/projects/${project}/cli/login-role`,undefined,'synthetic',fetchImpl),{message:'ok'});
 for(const [method,path,body] of [['DELETE',`/v1/projects/${parent}/cli/login-role`,undefined],
  ['DELETE',`/v1/projects/${project}/cli/login-role`,{}],['POST',`/v1/projects/${project}/database/query`,{query:`DROP ROLE "${role}";`}]]){
  await assert.rejects(()=>credentialRequest(method,path,body,'synthetic',fetchImpl));
 }
 assert.equal(calls,1);
});
test('native client uses only a fixed readonly statement and raw password environment',()=>{
 const result={currentUser:'postgres',sessionUser:role,database:'postgres',readOnly:'on',bypassRls:true};
 assert.deepEqual(probeCredential({hostname:'aws-1-ap-southeast-1.pooler.supabase.com',role,password,execute:(cmd,args,opts)=>{
  assert.equal(cmd,'psql');assert.ok(!args.join(' ').includes(password));assert.equal(opts.env.PGPASSWORD,password);
  assert.equal(opts.env.PGUSER,role+'.'+project);assert.equal(opts.env.PGPORT,'6543');assert.match(opts.input,/BEGIN READ ONLY/);
  assert.equal(opts.env.SUPABASE_ACCESS_TOKEN,undefined);return JSON.stringify(result);
 }}),result);
});
test('HTTP adapter rejects Primary writes before fetch',async()=>{
 let calls=0;await assert.rejects(()=>credentialRequest('POST',`/v1/projects/${parent}/database/password`,{},'synthetic',()=>{calls++;}));
 assert.equal(calls,0);
});
