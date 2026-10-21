import {expect,test} from 'vitest';
import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {execFileSync} from 'node:child_process';
import {validateExceptionActivation,validateExceptionWindow,hasReleaseCredentials,isCleanExceptionCheckout,assertExceptionExecutionEnvironment} from './web-audit-exception-activation.mjs';
const policy=JSON.parse(readFileSync(new URL('../web-release-audit-exception.json',import.meta.url)));
const now=Date.parse('2026-10-20T00:00:00Z');
function inputs(){const candidate={head:'a'.repeat(40),tree:'b'.repeat(40),sourceSha256:'c'.repeat(64),lockSha256:policy.lockBytesSha256};return {policy,policySha256:'e'.repeat(64),candidate,artifact:{...candidate,status:'PASS',scope:'WEB_KNOWN_NATIVE_DEPENDENCY_EXCLUSION',sbomSha256:'2'.repeat(64),auditSha256:'3'.repeat(64),advisoryRuntimeExclusion:{status:'PASS',scope:'REVIEWED_SOURCE_LITERAL_IMPORTS_AND_NFT_PACKAGE_CLOSURE',traces:1},artifactSha256:'f'.repeat(64),buildId:'fresh',installation:{sbom:'PASS',installedGraphSha256:'1'.repeat(64)},runtimeLoaderSafety:'NOT_PROVEN'},sbomSha256:'2'.repeat(64),auditSha256:'3'.repeat(64),advisoryRuntimeExclusion:{status:'PASS',scope:'REVIEWED_SOURCE_LITERAL_IMPORTS_AND_NFT_PACKAGE_CLOSURE',traces:1},lint:{status:'PASS',logSha256:'4'.repeat(64),configSha256:policy.lintConfigSha256,rootDir:'UNSET',ruleEnabled:true},isolation:{platform:'linux',ci:true,githubHosted:true,workspaceMatches:true,cleanCheckout:true,loopbackServices:true,noReleaseCredentials:true,runId:'123',runAttempt:'1',job:'verify',sha:candidate.head}};}
test('only activates an exact candidate after artifact SBOM lint and isolation proof',()=>{expect(validateExceptionActivation(inputs(),now)).toMatchObject({status:'ACTIVATED',head:'a'.repeat(40),auditStatus:'NON_PASS',vulnerabilityRemediation:'NOT_FIXED',expiresAt:'2026-10-22T14:00:00Z'});});
test('fixed window rejects expiry, preauthorization and sliding extension',()=>{expect(()=>validateExceptionWindow(policy,Date.parse(policy.expiresAt))).toThrow('EXPIRED');expect(()=>validateExceptionWindow(policy,Date.parse('2026-10-19T15:53:57Z'))).toThrow('NOT_STARTED');expect(()=>validateExceptionWindow({...policy,expiresAt:'2026-10-23T14:00:00Z'},now)).toThrow('WINDOW_UNREVIEWED');});

test('lock amendment requires its exact separate authorization and rejects stale or arbitrary bindings',()=>{
 expect(policy.lockRebind?.authorizationMessage).toBe('Sentinel_a4cb747e08008191a8ca1859de6f791a');
 expect(()=>validateExceptionWindow(policy,now)).not.toThrow();
 for(const patch of [{lockRebind:undefined},{lockRebind:{...policy.lockRebind,authorizationMessage:'OTHER'}},
  {lockRebind:{...policy.lockRebind,to:'1.16.2'}},{lockRebind:{...policy.lockRebind,otherPackage:'unreviewed'}},
  {lockSha256:'00f3c2b4363f58e2485fb9139142ac9d611671ad04e8561150cf35be8015bc6c'},
  {lockBytesSha256:'d284d352264e152619d134d21c5323005e2727f314672e74ff3dff54e91379ef'},
  {lockSha256:'0'.repeat(64)},{lockBytesSha256:'0'.repeat(64)}])
  expect(()=>validateExceptionWindow({...policy,...patch},now)).toThrow();
});
test.each(['head','tree','sourceSha256','lockSha256'])('rejects stale artifact %s',key=>{const x=inputs();x.artifact[key]='0'.repeat(x.candidate[key].length);expect(()=>validateExceptionActivation(x,now)).toThrow('CANDIDATE_MISMATCH');});
test.each(['artifact','lint','isolation','sbomSha256','auditSha256'])('rejects missing %s evidence',key=>{const x=inputs();delete x[key];expect(()=>validateExceptionActivation(x,now)).toThrow();});
test.each(['cleanCheckout','loopbackServices','noReleaseCredentials','githubHosted','workspaceMatches'])('rejects isolation condition %s',key=>{const x=inputs();x.isolation[key]=false;expect(()=>validateExceptionActivation(x,now)).toThrow('ISOLATION');});
test('rejects wrong workflow SHA, unverified SBOM, runtime claim and lint pattern drift',()=>{for(const mutate of [x=>x.isolation.sha='0'.repeat(40),x=>x.artifact.installation.sbom='INCOMPLETE',x=>x.artifact.runtimeLoaderSafety='PROVEN',x=>x.lint.rootDir='**',x=>x.lint.configSha256='0'.repeat(64)]){const x=inputs();mutate(x);expect(()=>validateExceptionActivation(x,now)).toThrow();}});
test.each(['SUPABASE_SECRET_KEY','PRIMARY_SUPABASE_SECRET_KEY','DR_SUPABASE_SECRET_KEY','SUPABASE_SERVICE_ROLE_KEY','SUPABASE_ACCESS_TOKEN','VERCEL_TOKEN','VERCEL_AUTOMATION_BYPASS_SECRET','CLOUDFLARE_API_TOKEN','GITHUB_TOKEN','GH_TOKEN','PGPASSWORD','PRIMARY_REPLICATION_PASSWORD','DR_SUPABASE_DB_PASSWORD','LINE_CHANNEL_SECRET','PAYMENT_LINE_PAY_CHANNEL_SECRET','ACTIONS_ID_TOKEN_REQUEST_TOKEN'])('rejects release credential alias %s',name=>{expect(hasReleaseCredentials({[name]:'synthetic-never-a-real-secret'})).toBe(true);});
test('permits only the explicit ephemeral runner token exception and public config',()=>{expect(hasReleaseCredentials({ACTIONS_RUNTIME_TOKEN:'synthetic',NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:'public'})).toBe(false);});
test('preflight refuses credentials or non-loopback services before code execution',()=>{const env={DATABASE_URL:'postgresql://synthetic@127.0.0.1/test',DIRECT_URL:'postgresql://synthetic@localhost/test',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:54321'};expect(()=>assertExceptionExecutionEnvironment(env)).not.toThrow();expect(()=>assertExceptionExecutionEnvironment({...env,PRIMARY_SUPABASE_SECRET_KEY:'synthetic'})).toThrow('ISOLATION');expect(()=>assertExceptionExecutionEnvironment({...env,DATABASE_URL:'postgresql://synthetic@remote.invalid/test'})).toThrow('ISOLATION');});
test('untracked and ignored source cannot reuse HEAD; only owned evidence is allowed',()=>{
 const root=mkdtempSync(join(tmpdir(),'web-exception-clean-'));
 try{
  writeFileSync(join(root,'tracked.txt'),'baseline');writeFileSync(join(root,'.gitignore'),'src/ignored.ts\n.env*\nnext.config.local.js\n');
  const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
  git('init','--quiet');git('add','.');git('-c','user.name=Synthetic QA','-c','user.email=qa@example.invalid','commit','--quiet','-m','fixture');
  const evidence=join(root,'evidence');mkdirSync(evidence);writeFileSync(join(evidence,'receipt.json'),'{}');
  expect(isCleanExceptionCheckout(root,evidence)).toBe(true);
  mkdirSync(join(root,'src'));writeFileSync(join(root,'src','untracked.ts'),'export const unexpected=true;');
  expect(isCleanExceptionCheckout(root,evidence)).toBe(false);
  rmSync(join(root,'src','untracked.ts'));writeFileSync(join(root,'src','ignored.ts'),'export const hidden=true;');
  expect(isCleanExceptionCheckout(root,evidence)).toBe(false);
  rmSync(join(root,'src','ignored.ts'));writeFileSync(join(root,'.env.local'),'SUPABASE_SECRET_KEY=synthetic\n');
  expect(isCleanExceptionCheckout(root,evidence)).toBe(false);
  rmSync(join(root,'.env.local'));writeFileSync(join(root,'next.config.local.js'),'export default {};');
  expect(isCleanExceptionCheckout(root,evidence)).toBe(false);
 }finally{rmSync(root,{recursive:true,force:true});}
});
test('requires fresh lint success, log digest, exact lock and bounded runtime exclusion',()=>{for(const mutate of [x=>x.lint.status='NON_PASS',x=>delete x.lint.logSha256,x=>delete x.artifact.advisoryRuntimeExclusion,x=>x.candidate.lockSha256=x.artifact.lockSha256='0'.repeat(64),x=>x.sbomSha256='0'.repeat(64)]){const x=inputs();mutate(x);expect(()=>validateExceptionActivation(x,now)).toThrow();}});
