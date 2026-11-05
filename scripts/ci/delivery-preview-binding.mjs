import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
export const PREVIEW_BINDING=Object.freeze({parent:'eyuctbnlvnbnivwasvqr',project:'teunnvfakbfzmodajqjz',branchId:'e232885a-7d2e-4254-91f9-3a1edf9625e2',name:'pr-389-oauth-delivery',gitBranch:'codex/conversion-source-checks-20261023'});
export function verifyExistingPreview({parent,branches}) {
 assert.equal(parent,PREVIEW_BINDING.parent); assert.ok(Array.isArray(branches)); assert.ok(branches.length<=200);
 const matches=branches.filter(b=>b.name===PREVIEW_BINDING.name||b.id===PREVIEW_BINDING.branchId||b.project_ref===PREVIEW_BINDING.project);
 assert.equal(matches.length,1,'exactly one existing isolated branch required'); const b=matches[0];
 for(const [key,value] of Object.entries({id:PREVIEW_BINDING.branchId,name:PREVIEW_BINDING.name,project_ref:PREVIEW_BINDING.project,parent_project_ref:parent,git_branch:PREVIEW_BINDING.gitBranch,is_default:false,persistent:false,with_data:false,preview_project_status:'ACTIVE_HEALTHY'})) assert.equal(b[key],value,'branch binding mismatch: '+key);
 assert.ok(['ACTIVE_HEALTHY','MIGRATIONS_FAILED'].includes(b.status),'branch provisioning not terminal');
 return {projectRef:PREVIEW_BINDING.project,createAllowed:false,deleteAllowed:false,schemaQualified:false};
}
class PreviewConfigurationError extends Error {
 constructor(code) { super(code); this.code=code; }
}
function configCheck(condition,code) { if(!condition) throw new PreviewConfigurationError(code); }
export function previewBindingFailureCode(error) {
 return error instanceof PreviewConfigurationError ? error.code : 'PREVIEW_BINDING_REJECTED';
}
export function verifyPreviewConfiguration(config) {
 configCheck(config && typeof config==='object','PREVIEW_CONFIG_SHAPE');
 for(const field of ['POSTGRES_URL','SUPABASE_URL','SUPABASE_ANON_KEY']) {
  configCheck(typeof config[field]==='string' && config[field].length>0,'PREVIEW_CONFIG_REQUIRED_FIELD');
  configCheck(!/[\x00-\x1f\x7f]/.test(config[field]),'PREVIEW_CONFIG_CONTROL_CHARACTER');
 }
 configCheck(config.SUPABASE_URL==='https://'+PREVIEW_BINDING.project+'.supabase.co','PREVIEW_CONFIG_API_TARGET');
 let u;try{u=new URL(config.POSTGRES_URL);}catch{throw new PreviewConfigurationError('PREVIEW_CONFIG_URI');}
 // libpq accepts both spellings; every identity and connection restriction below is shared.
 configCheck(['postgresql:','postgres:'].includes(u.protocol),'PREVIEW_CONFIG_PROTOCOL');
 configCheck(u.pathname==='/postgres','PREVIEW_CONFIG_DATABASE');
 configCheck(u.hash==='','PREVIEW_CONFIG_FRAGMENT');
 configCheck(u.password.length>0,'PREVIEW_CONFIG_PASSWORD');
 const direct=u.hostname==='db.'+PREVIEW_BINDING.project+'.supabase.co';
 // Pin the region requested for this existing branch; the live child config must match.
 configCheck(direct || /^aws-[0-9]+-ap-southeast-1\.pooler\.supabase\.com$/.test(u.hostname),'PREVIEW_CONFIG_REGION_TARGET');
 let username;try{username=decodeURIComponent(u.username);}catch{throw new PreviewConfigurationError('PREVIEW_CONFIG_USERNAME');}
 configCheck(username===(direct?'postgres':'postgres.'+PREVIEW_BINDING.project),'PREVIEW_CONFIG_USERNAME');
 configCheck((direct?['5432']:['5432','6543']).includes(u.port),'PREVIEW_CONFIG_PORT');
 const allowed={sslmode:['require','verify-full'],pgbouncer:['true'],connect_timeout:['10']};
 for(const [key,value] of u.searchParams) {
  configCheck(allowed[key]?.includes(value),'PREVIEW_CONFIG_QUERY_OPTION');
  configCheck(u.searchParams.getAll(key).length===1,'PREVIEW_CONFIG_QUERY_DUPLICATE');
 }
 return {projectRef:PREVIEW_BINDING.project};
}
export function verifyPreviewInvocation(v) {
 assert.equal(v.repository,'KenLeeYa/Stallorder-Platform');
 if(v.event==='workflow_dispatch') {
  assert.equal(v.actor,'KenLeeYa'); assert.ok(['refs/heads/main','refs/heads/staging'].includes(v.ref));
 } else {
  assert.equal(v.event,'pull_request'); assert.equal(v.headRepo,v.repository);
  assert.ok(Number.isSafeInteger(v.number)&&v.number>0);
  assert.ok((v.number===390 && v.headBranch===PREVIEW_BINDING.gitBranch && v.baseBranch==='staging')
   || (v.headBranch==='staging' && v.baseBranch==='main'),'unapproved installation source');
 }
 return {resourceKey:'pr-389',projectRef:PREVIEW_BINDING.project};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  assert.equal(process.env.GITHUB_REPOSITORY,'KenLeeYa/Stallorder-Platform');
  assert.equal(process.env.PREVIEW_RESOURCE_KEY,'pr-389');
  assert.equal(process.env.PREVIEW_GIT_BRANCH,PREVIEW_BINDING.gitBranch);
  const mode=process.argv[2]??'branches';
  if(mode==='invocation') {
   const eventBytes=readFileSync(process.env.GITHUB_EVENT_PATH,'utf8');
   assert.ok(Buffer.byteLength(eventBytes)<=131072); const e=JSON.parse(eventBytes);
   verifyPreviewInvocation({repository:process.env.GITHUB_REPOSITORY,actor:process.env.GITHUB_ACTOR,
    event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,headRepo:e.pull_request?.head?.repo?.full_name,
    headBranch:e.pull_request?.head?.ref,baseBranch:e.pull_request?.base?.ref,number:e.pull_request?.number});
  } else {
   const input=readFileSync(0,'utf8'); assert.ok(Buffer.byteLength(input)<=131072,'input too large');
   assert.equal(process.env.SUPABASE_PARENT_PROJECT_REF,PREVIEW_BINDING.parent);
   assert.ok(['branches','config'].includes(mode));
   const result=mode==='config'?verifyPreviewConfiguration(JSON.parse(input)):
    verifyExistingPreview({parent:process.env.SUPABASE_PARENT_PROJECT_REF,branches:JSON.parse(input)});
   console.log(result.projectRef);
  }
 } catch(error) { console.error(previewBindingFailureCode(error)+': Existing PR389 Preview binding failed; creation and deletion are forbidden.'); process.exitCode=1; }
}
