import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {join,relative} from 'node:path';
import {execFileSync} from 'node:child_process';

const digest=value=>createHash('sha256').update(value).digest('hex');
const reject=code=>{throw new Error('WEB_EXCEPTION_'+code);};
const fingerprint=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
export function readCandidateContext(env){
 if(env.GITHUB_REPOSITORY!=='KenLeeYa/Stallorder-Platform'||!/^[a-f0-9]{40}$/.test(env.GITHUB_SHA??''))reject('CANDIDATE_CONTEXT');
 if(env.GITHUB_EVENT_NAME==='pull_request'){
  let event;try{event=JSON.parse(readFileSync(env.GITHUB_EVENT_PATH,'utf8'));}catch{reject('CANDIDATE_CONTEXT');}
  const head=event.pull_request?.head;
  if(event.number!==366||head?.ref!=='codex/integrated-production-20261002'||head?.repo?.full_name!==env.GITHUB_REPOSITORY||!/^[a-f0-9]{40}$/.test(head?.sha??''))reject('CANDIDATE_CONTEXT');
  return {candidateSha:head.sha,workflowSha:env.GITHUB_SHA,source:'PULL_REQUEST_HEAD'};
 }
 if(!['workflow_dispatch','push'].includes(env.GITHUB_EVENT_NAME))reject('CANDIDATE_CONTEXT');
 return {candidateSha:env.GITHUB_SHA,workflowSha:env.GITHUB_SHA,source:'WORKFLOW_REF'};
}
export function hasReleaseCredentials(env){
 // Only the hosted runner's ephemeral artifact-service token is allowed here.
 return Object.entries(env).some(([name,value])=>value&&name!=='ACTIONS_RUNTIME_TOKEN'&&/(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|SERVICE_ROLE|API_KEY|ACCESS_KEY|CREDENTIAL)/i.test(name));
}
export function assertExceptionExecutionEnvironment(env){
 const loopback=value=>{try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
 if(hasReleaseCredentials(env)||![env.DATABASE_URL,env.DIRECT_URL,env.NEXT_PUBLIC_SUPABASE_URL].every(loopback))reject('ISOLATION_REQUIRED');
}
export function isCleanExceptionCheckout(root,evidenceDirectory){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'});
 const evidencePrefix=evidenceDirectory?relative(root,evidenceDirectory).replaceAll('\\','/')+'/':null;
 const untracked=git('ls-files','--others','--exclude-standard','-z').split('\0').filter(Boolean);
 const untrackedInputs=git('ls-files','--others','-z','--','src','packages/contracts','public','prisma','supabase/functions/_shared','scripts','.env*','.npmrc','next.config.*','tsconfig*.json','postcss.config.*','eslint.config.*','package*.json','vercel.json').split('\0').filter(Boolean);
 return git('diff','HEAD','--name-only').trim()===''&&untrackedInputs.length===0&&!untracked.some(path=>!evidencePrefix||!path.startsWith(evidencePrefix));
}
export function validateExceptionWindow(policy,now=Date.now()){
 if(policy.id!=='WEB-20261019-ONE-WINDOW-BRACES'||policy.expiresAt!=='2026-10-22T14:00:00Z'||policy.authorizedAt!=='2026-10-19T15:53:58Z'||policy.authorizationMessage!=='Sentinel_2859b6c9b0908191a8647cc7508aa2bc'||policy.scope!=='WEB_ONLY_ONE_ACCEPTANCE_WINDOW'||policy.preparationBase!=='980309944db37379906c44714387ff65fa22fc0c')reject('WINDOW_UNREVIEWED');
 if(policy.hashByteContract!=='COMMITTED_GIT_BLOB_LF_BYTES_FOR_HOSTED_LINUX_CHECKOUT'||policy.lockBytesSha256!=='115b0966e3ef571f968ad50dc7f9c54634a8c3e5b45f8fd574b642c7384a141a'||policy.lockSha256!=='72ef791033d591a4495d3d14f42fb467d2894558b0d33fe86dbf5e028dba827a'||policy.lintConfigSha256!=='8fd517247f4021feb4bfeb4edb33d14e1579084e0ff413ab7c3bc6d31e587313')reject('POLICY_BINDING_UNREVIEWED');
 const amendment={authorizationMessage:'Sentinel_a4cb747e08008191a8ca1859de6f791a',candidateBase:'86bd17f450d32cf69f8560102150d91656edc5af',package:'follow-redirects',from:'1.16.0',to:'1.16.1',previousLockSha256:'00f3c2b4363f58e2485fb9139142ac9d611671ad04e8561150cf35be8015bc6c',previousLockBytesSha256:'d284d352264e152619d134d21c5323005e2727f314672e74ff3dff54e91379ef'};
 if(!policy.lockRebind||Object.keys(policy.lockRebind).length!==Object.keys(amendment).length||Object.entries(amendment).some(([key,value])=>policy.lockRebind[key]!==value))reject('LOCK_REBIND_UNREVIEWED');
 const viteAmendment={"authorizationMessage":"Sentinel_4667d21038ec81918e0646b937fc3b15","candidateBase":"c9ff9c6de43cd660797156f1fbd44a3dcc60dbac","package":"vite","from":"8.2.2","to":"8.2.4","previousLockSha256":"7273203027bb3e4c194cedcc5890bcc9d164c9d41a0b8dee9ae3e1f081c62f97","previousLockBytesSha256":"51d616877d27acbb72a1c788fad7ea6c80abdcd045f99c6254b29b6eaa978732"};
 if(!policy.viteLockRebind||Object.keys(policy.viteLockRebind).length!==Object.keys(viteAmendment).length||Object.entries(viteAmendment).some(([key,value])=>policy.viteLockRebind[key]!==value))reject('VITE_LOCK_REBIND_UNREVIEWED');
 if(!Number.isFinite(now)||now>=Date.parse(policy.expiresAt))reject('EXPIRED');
 if(now<Date.parse(policy.authorizedAt))reject('NOT_STARTED');
}
export function validateExceptionActivation(input,now=Date.now()){
 const {policy,candidate,artifact,lint,isolation}=input;
 validateExceptionWindow(policy,now);
 if(!candidate||!artifact||artifact.status!=='PASS'||artifact.scope!=='WEB_KNOWN_NATIVE_DEPENDENCY_EXCLUSION'||artifact.runtimeLoaderSafety!=='NOT_PROVEN')reject('ARTIFACT_REQUIRED');
 for(const key of ['head','tree','sourceSha256','lockSha256']){
  if(typeof candidate[key]!=='string'||!new RegExp(`^[a-f0-9]{${key==='head'||key==='tree'?40:64}}$`).test(candidate[key])||candidate[key]!==artifact[key])reject('CANDIDATE_MISMATCH');
 }
 if(candidate.lockSha256!==policy.lockBytesSha256)reject('LOCK_MISMATCH');
 if(!fingerprint(input.policySha256)||!fingerprint(input.sbomSha256)||!fingerprint(input.auditSha256)||!fingerprint(artifact.artifactSha256)||!fingerprint(artifact.installation?.installedGraphSha256)||artifact.installation.sbom!=='PASS'||typeof artifact.buildId!=='string'||!artifact.buildId.trim())reject('EVIDENCE_REQUIRED');
 if(artifact.sbomSha256!==input.sbomSha256||artifact.auditSha256!==input.auditSha256)reject('EVIDENCE_MISMATCH');
 if(artifact.advisoryRuntimeExclusion?.status!=='PASS'||artifact.advisoryRuntimeExclusion.scope!=='REVIEWED_SOURCE_LITERAL_IMPORTS_AND_NFT_PACKAGE_CLOSURE'||!Number.isSafeInteger(artifact.advisoryRuntimeExclusion.traces)||artifact.advisoryRuntimeExclusion.traces<1)reject('RUNTIME_EXCLUSION_REQUIRED');
 if(!lint||lint.status!=='PASS'||!fingerprint(lint.logSha256)||lint.configSha256!==policy.lintConfigSha256||!fingerprint(lint.configSha256)||lint.rootDir!=='UNSET'||lint.ruleEnabled!==true)reject('LINT_UNCONTROLLED');
 if(!isolation||isolation.platform!=='linux'||isolation.ci!==true||isolation.githubHosted!==true||isolation.workspaceMatches!==true||isolation.cleanCheckout!==true||isolation.loopbackServices!==true||isolation.noReleaseCredentials!==true||!/^\d+$/.test(isolation.runId??'')||!/^\d+$/.test(isolation.runAttempt??'')||!isolation.job||isolation.sha!==candidate.head)reject('ISOLATION_REQUIRED');
 return {status:'ACTIVATED',windowId:policy.id,expiresAt:policy.expiresAt,...candidate,policySha256:input.policySha256,artifactSha256:artifact.artifactSha256,buildId:artifact.buildId,sbomSha256:input.sbomSha256,auditSha256:input.auditSha256,installedGraphSha256:artifact.installation.installedGraphSha256,advisoryRuntimeExclusion:artifact.advisoryRuntimeExclusion,lint,isolation,auditStatus:'NON_PASS',vulnerabilityRemediation:'NOT_FIXED'};
}
/** Collect from this process/checkout, never from a caller-supplied activation file. */
export function collectExceptionActivation(root,policy,policySha256,candidate,artifact,sbom,audit,env=process.env,evidenceDirectory,lintEvidence){
 assertExceptionExecutionEnvironment(env);
 const context=readCandidateContext(env);
 if(context.candidateSha!==candidate.head)reject('CANDIDATE_MISMATCH');
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 if(git('rev-parse','HEAD')!==candidate.head||git('rev-parse','HEAD^{tree}')!==candidate.tree)reject('CANDIDATE_MISMATCH');
 execFileSync('git',['merge-base','--is-ancestor',policy.preparationBase,candidate.head],{cwd:root});
 const cleanCheckout=isCleanExceptionCheckout(root,evidenceDirectory);
 const script="import {ESLint} from 'eslint';const c=await new ESLint().calculateConfigForFile('src/app/page.tsx');console.log(JSON.stringify({rootDir:c.settings?.next?.rootDir===undefined?'UNSET':'CUSTOM',ruleEnabled:(c.rules?.['@next/next/no-html-link-for-pages']?.[0]??0)>0}));";
 const settings=JSON.parse(execFileSync(process.execPath,['--input-type=module','-e',script],{cwd:root,encoding:'utf8',timeout:30000}));
 const loopback=value=>{try{return ['localhost','127.0.0.1','[::1]'].includes(new URL(value).hostname);}catch{return false;}};
 const isolation={platform:process.platform,ci:env.CI==='true'&&env.GITHUB_ACTIONS==='true',githubHosted:env.RUNNER_ENVIRONMENT==='github-hosted',workspaceMatches:env.GITHUB_WORKSPACE===root,cleanCheckout,loopbackServices:[env.DATABASE_URL,env.DIRECT_URL,env.NEXT_PUBLIC_SUPABASE_URL].every(loopback),noReleaseCredentials:!hasReleaseCredentials(env),runId:env.GITHUB_RUN_ID,runAttempt:env.GITHUB_RUN_ATTEMPT,job:env.GITHUB_JOB,sha:context.candidateSha,workflowSha:context.workflowSha,candidateSource:context.source};
 return validateExceptionActivation({policy,policySha256,candidate,artifact,sbomSha256:digest(JSON.stringify(sbom)),auditSha256:digest(JSON.stringify(audit)),lint:{...lintEvidence,...settings,configSha256:digest(readFileSync(join(root,'eslint.config.mjs')))},isolation});
}
