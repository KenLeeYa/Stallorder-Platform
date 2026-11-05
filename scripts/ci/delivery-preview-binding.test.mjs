import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyExistingPreview, PREVIEW_BINDING } from './delivery-preview-binding.mjs';
const fixture=()=>({parent:PREVIEW_BINDING.parent,branches:[{id:PREVIEW_BINDING.branchId,name:PREVIEW_BINDING.name,project_ref:PREVIEW_BINDING.project,parent_project_ref:PREVIEW_BINDING.parent,git_branch:PREVIEW_BINDING.gitBranch,is_default:false,persistent:false,with_data:false,status:'MIGRATIONS_FAILED',preview_project_status:'ACTIVE_HEALTHY'}]});
test('reuses only the bound healthy existing PR389 resource without granting schema acceptance',()=>{
 const input=fixture(); const frozen=structuredClone(input); const out=verifyExistingPreview(input); assert.deepEqual(input,frozen);
 assert.deepEqual(out,{projectRef:PREVIEW_BINDING.project,createAllowed:false,deleteAllowed:false,schemaQualified:false});
});
for(const [name,mutate] of [
 ['missing resource',x=>x.branches=[]],['duplicate resource',x=>x.branches.push({...x.branches[0]})],
 ['parent',x=>x.parent='foreign'],['branch identity',x=>x.branches[0].id='foreign'],
 ['project',x=>x.branches[0].project_ref=PREVIEW_BINDING.parent],['branch name',x=>x.branches[0].name='foreign'],
 ['provider parent',x=>x.branches[0].parent_project_ref='foreign'],['git branch',x=>x.branches[0].git_branch='foreign'],
 ['default branch',x=>x.branches[0].is_default=true],['production data',x=>x.branches[0].with_data=true],
 ['persistent branch',x=>x.branches[0].persistent=true],['unhealthy project',x=>x.branches[0].preview_project_status='INACTIVE'],
 ['active migration',x=>x.branches[0].status='MIGRATING'],['unknown data flag',x=>delete x.branches[0].with_data],
])test('rejects '+name,()=>{const x=fixture();mutate(x);assert.throws(()=>verifyExistingPreview(x));});

import { verifyPreviewConfiguration, verifyPreviewInvocation } from './delivery-preview-binding.mjs';
const config=()=>({POSTGRES_URL:'postgresql://postgres.teunnvfakbfzmodajqjz:synthetic-placeholder@aws-1-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require',SUPABASE_URL:'https://teunnvfakbfzmodajqjz.supabase.co',SUPABASE_ANON_KEY:'synthetic-public-key'});
test('verifies actual pooler and API target without returning credentials',()=>{
 const c=config();const out=verifyPreviewConfiguration(c);
 assert.deepEqual(out,{projectRef:PREVIEW_BINDING.project});assert.ok(!JSON.stringify(out).includes('synthetic'));
});
test('allows a same-project direct PostgreSQL endpoint',()=>{
 const c=config();c.POSTGRES_URL='postgresql://postgres:synthetic-placeholder@db.teunnvfakbfzmodajqjz.supabase.co:5432/postgres';
 assert.equal(verifyPreviewConfiguration(c).projectRef,PREVIEW_BINDING.project);
});
for(const [name,mutate] of [
 ['Primary API',c=>c.SUPABASE_URL='https://eyuctbnlvnbnivwasvqr.supabase.co'],
 ['foreign API port',c=>c.SUPABASE_URL+=':443'],
 ['Primary pooler user',c=>c.POSTGRES_URL=c.POSTGRES_URL.replace('teunnvfakbfzmodajqjz','eyuctbnlvnbnivwasvqr')],
 ['foreign pooler',c=>c.POSTGRES_URL=c.POSTGRES_URL.replace('pooler.supabase.com','pooler.attacker.test')],
 ['query host override',c=>c.POSTGRES_URL+='&host=db.eyuctbnlvnbnivwasvqr.supabase.co'],
 ['query service override',c=>c.POSTGRES_URL+='&service=production'],
 ['query user override',c=>c.POSTGRES_URL+='&user=postgres.eyuctbnlvnbnivwasvqr'],
 ['query options override',c=>c.POSTGRES_URL+='&options=-csearch_path=public'],
 ['unknown database',c=>c.POSTGRES_URL=c.POSTGRES_URL.replace('/postgres?','/other?')],
 ['plaintext SSL override',c=>c.POSTGRES_URL=c.POSTGRES_URL.replace('sslmode=require','sslmode=disable')],
 ['fragment',c=>c.POSTGRES_URL+='#extra'],
 ['missing public key',c=>delete c.SUPABASE_ANON_KEY],
])test('rejects configuration '+name,()=>{const c=config();mutate(c);assert.throws(()=>verifyPreviewConfiguration(c));});
const invocation=()=>({repository:'KenLeeYa/Stallorder-Platform',actor:'KenLeeYa',event:'pull_request',ref:'refs/pull/390/merge',headRepo:'KenLeeYa/Stallorder-Platform',headBranch:PREVIEW_BINDING.gitBranch,baseBranch:'staging',number:390});
test('permits exact installation PR390 and staging-to-main promotion on the same existing resource',()=>{
 assert.equal(verifyPreviewInvocation(invocation()).resourceKey,'pr-389');
 assert.equal(verifyPreviewInvocation({...invocation(),number:400,headBranch:'staging',baseBranch:'main'}).resourceKey,'pr-389');
 assert.equal(verifyPreviewInvocation({...invocation(),event:'workflow_dispatch',ref:'refs/heads/main'}).resourceKey,'pr-389');
});
for(const [name,change] of [
 ['completed installation PR',v=>v.number=389],
 ['another PR number',v=>v.number=401],['foreign branch',v=>v.headBranch='feature'],
 ['fork',v=>v.headRepo='other/Stallorder-Platform'],['wrong target',v=>v.baseBranch='main'],
 ['nonowner manual',v=>{v.event='workflow_dispatch';v.ref='refs/heads/main';v.actor='other';}],
 ['unprotected manual ref',v=>{v.event='workflow_dispatch';v.ref='refs/heads/feature';}],
 ['wrong repository',v=>v.repository='other/Stallorder-Platform'],
])test('rejects invocation '+name,()=>{const v=invocation();change(v);assert.throws(()=>verifyPreviewInvocation(v));});

for(const field of ['POSTGRES_URL','SUPABASE_URL','SUPABASE_ANON_KEY']) for(const delimiter of ['\n','\r','\u0000','\t','\u007f']) test('rejects raw environment control character '+field+' '+delimiter.charCodeAt(0),()=>{
 const c=config(); c[field]+=delimiter+'EPHEMERAL_DATABASE_URL=postgresql://synthetic.invalid/postgres';
 assert.throws(()=>verifyPreviewConfiguration(c));
});

test("rejects the Primary region when the existing Preview was provisioned elsewhere",()=>{const c=config(); c.POSTGRES_URL=c.POSTGRES_URL.replace("ap-southeast-1","ap-northeast-1");assert.throws(()=>verifyPreviewConfiguration(c));});

import { previewBindingFailureCode } from './delivery-preview-binding.mjs';
test('accepts the libpq postgres URI alias with identical target restrictions',()=>{
 const c=config();c.POSTGRES_URL=c.POSTGRES_URL.replace('postgresql:','postgres:');
 assert.equal(verifyPreviewConfiguration(c).projectRef,PREVIEW_BINDING.project);
 c.POSTGRES_URL=c.POSTGRES_URL.replace(PREVIEW_BINDING.project,PREVIEW_BINDING.parent);
 assert.throws(()=>verifyPreviewConfiguration(c));
});
test('reports only fixed diagnostic codes and never assertion values or credentials',()=>{
 for(const [mutate,expected] of [
  [c=>c.POSTGRES_URL='https://SECRET-MARKER.invalid','PREVIEW_CONFIG_PROTOCOL'],
  [c=>c.POSTGRES_URL=c.POSTGRES_URL.replace('ap-southeast-1','ap-northeast-1'),'PREVIEW_CONFIG_REGION_TARGET'],
  [c=>c.SUPABASE_URL='https://SECRET-MARKER.invalid','PREVIEW_CONFIG_API_TARGET'],
  [c=>delete c.SUPABASE_ANON_KEY,'PREVIEW_CONFIG_REQUIRED_FIELD'],
  [c=>c.POSTGRES_URL+='&host=SECRET-MARKER','PREVIEW_CONFIG_QUERY_OPTION'],
 ]) {const c=config();mutate(c);let error;try{verifyPreviewConfiguration(c);}catch(e){error=e;}
  assert.ok(error);assert.equal(previewBindingFailureCode(error),expected);
  assert.ok(!previewBindingFailureCode(error).includes('SECRET-MARKER'));
 }
 assert.equal(previewBindingFailureCode(new Error('SECRET-MARKER')),'PREVIEW_BINDING_REJECTED');
 assert.equal(previewBindingFailureCode({code:'SECRET-MARKER'}),'PREVIEW_BINDING_REJECTED');
});

test('accepts only the fixed CLI connection timeout from pinned Supabase 2.109.1',()=>{
 const c=config();c.POSTGRES_URL+='&connect_timeout=10';
 assert.equal(verifyPreviewConfiguration(c).projectRef,PREVIEW_BINDING.project);
 c.POSTGRES_URL=c.POSTGRES_URL.replace('connect_timeout=10','connect_timeout=0');
 assert.throws(()=>verifyPreviewConfiguration(c));
});
test('rejects duplicate provider timeout and JIT options before runtime export',()=>{
 const c=config();c.POSTGRES_URL+='&connect_timeout=10&connect_timeout=10';assert.throws(()=>verifyPreviewConfiguration(c));
 c.POSTGRES_URL=config().POSTGRES_URL+'&options=-c%20jit%3Dtrue';assert.throws(()=>verifyPreviewConfiguration(c));
});
