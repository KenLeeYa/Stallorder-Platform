import {mkdirSync,realpathSync,writeFileSync,existsSync,readFileSync} from 'node:fs';
import {dirname,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {verifyWebInstallScope,supplementSharedWorkspaceSbom} from './verify-web-install-scope.mjs';
import {assertRootAudit,prepareWebAudit,verifyKnownNativeExclusion} from './lib/web-release-dependency-audit.mjs';

export function assertFreshWebRunner(root,env,platform=process.platform){
 if(platform!=='linux'||env.CI!=='true'||env.GITHUB_ACTIONS!=='true'||env.RUNNER_ENVIRONMENT!=='github-hosted'||!env.GITHUB_WORKSPACE||realpathSync(env.GITHUB_WORKSPACE)!==realpathSync(root))throw new Error('WEB_RELEASE_FRESH_HOSTED_RUNNER_REQUIRED');
}
/** The workflow performs selected npm ci first; this runner never installs or removes dependencies. */
export function runWebReleaseScope(root,evidenceDirectory){
 assertFreshWebRunner(root,process.env);
 const actualRoot=realpathSync(root),evidence=resolve(actualRoot,evidenceDirectory);
 if(!evidence.startsWith(actualRoot+sep)||existsSync(evidence))throw new Error('WEB_RELEASE_NEW_EVIDENCE_DIRECTORY_REQUIRED');
 let parent=dirname(evidence);while(!existsSync(parent))parent=dirname(parent);
 const realParent=realpathSync(parent);
 if(realParent!==actualRoot&&!realParent.startsWith(actualRoot+sep))throw new Error('WEB_RELEASE_EVIDENCE_PATH_ESCAPES_ROOT');
 mkdirSync(evidence,{recursive:true});
 const write=(name,value)=>writeFileSync(resolve(evidence,name),typeof value==='string'?value:JSON.stringify(value,null,2)+'\n',{flag:'wx'});
 const command=(args,name)=>{
  const result=spawnSync('npm',args,{cwd:actualRoot,encoding:'utf8',maxBuffer:64*1024*1024,timeout:30*60*1000});
  write(name,result.stdout??'');write(name+'.stderr',result.stderr??'');
  if(result.error||result.signal||!Number.isInteger(result.status))throw new Error('WEB_RELEASE_COMMAND_INCOMPLETE');
  return result;
 };
 const parse=result=>{try{return JSON.parse(result.stdout);}catch{throw new Error('WEB_RELEASE_JSON_INVALID');}};
 try{
  const npm=command(['--version'],'npm-version.txt');
  if(npm.status!==0||npm.stdout.trim()!=='11.16.0')throw new Error('WEB_RELEASE_NPM_VERSION_UNREVIEWED');
  write('installed.json',verifyWebInstallScope(actualRoot));
  const diagnostic=command(['audit','--json'],'full-repository-audit.json'),full=parse(diagnostic);
  write('full-repository-diagnostic.json',{status:full.error||!full.metadata?.vulnerabilities||!full.vulnerabilities?'INCOMPLETE':diagnostic.status===0&&full.metadata.vulnerabilities.total===0&&Object.keys(full.vulnerabilities).length===0?'PASS':'NON_PASS',vulnerabilities:full.metadata?.vulnerabilities??null,scope:'FULL_REPOSITORY_DIAGNOSTIC_ONLY',nativeRelease:'NOT_AUTHORIZED_NOT_PUBLISHED'});
  const audited=command(['audit','--workspace','packages/contracts','--include-workspace-root','--include=dev','--audit-level=moderate','--json'],'audit.json'),audit=parse(audited);
  const policyBytes=readFileSync(new URL('./web-release-audit-exception.json',import.meta.url)),policy=JSON.parse(policyBytes),exception={policy,lock:JSON.parse(readFileSync(resolve(actualRoot,'package-lock.json'),'utf8'))};
  const auditExceptionPolicySha256=createHash('sha256').update(policyBytes).digest('hex');
  if(![0,1].includes(audited.status))throw new Error('WEB_RELEASE_SELECTED_AUDIT_UNREVIEWED_EXIT');
  const usedException=audited.status===1,acceptedException=usedException?exception:undefined;
  assertRootAudit(audit,acceptedException);
  const selectedAuditStatus=usedException?'NON_PASS':'PASS',auditDecision=usedException?'USER_ACCEPTED_EXACT_EXCEPTION':'ZERO_VULNERABILITIES';
  write('selected-audit-decision.json',{auditStatus:selectedAuditStatus,releaseDecision:auditDecision,policyId:usedException?policy.id:null,policySha256:auditExceptionPolicySha256,advisory:usedException?policy.advisory:null});
  const raw=command(['sbom','--workspaces=false','--package-lock-only','--sbom-format','cyclonedx'],'npm-root-sbom.json');
  if(raw.status!==0)throw new Error('WEB_RELEASE_RAW_SBOM_NON_PASS');
  const supplemented=supplementSharedWorkspaceSbom(actualRoot,parse(raw));
  write('sbom.json',supplemented.sbom);write('sbom-supplement.json',supplemented.receipt);
  write('installed-sbom-coverage.json',verifyWebInstallScope(actualRoot,supplemented.sbom));
  const baseline=prepareWebAudit(actualRoot);write('prebuild.json',baseline);
  if(command(['run','build'],'build.log').status!==0)throw new Error('WEB_RELEASE_BUILD_NON_PASS');
  const receipt=verifyKnownNativeExclusion(actualRoot,baseline,audit,supplemented.sbom,acceptedException);
  write('artifact.json',receipt);
  if(receipt.status!=='PASS')throw new Error('WEB_RELEASE_ARTIFACT_NON_PASS');
  const verifierSha256=createHash('sha256').update(['./verify-web-release-scope.mjs','./verify-web-install-scope.mjs','./lib/web-release-dependency-audit.mjs'].map(path=>path+'\0'+readFileSync(new URL(path,import.meta.url),'utf8')).join('\n')).digest('hex');
  const result={selector:'npm ci --workspace packages/contracts --include-workspace-root --include=dev',npmVersion:'11.16.0',verifierSha256,status:'PASS',scope:'WEB_KNOWN_NATIVE_DEPENDENCY_EXCLUSION',head:receipt.head,tree:receipt.tree,sourceSha256:receipt.sourceSha256,lockSha256:receipt.lockSha256,artifactSha256:receipt.artifactSha256,buildId:receipt.buildId,installedGraphSha256:receipt.installation.installedGraphSha256,installedPackages:receipt.installation.installedPackages,fullRepositoryDiagnostic:'SEPARATE_NOT_A_RELEASE_PASS',runtimeLoaderSafety:'NOT_PROVEN',deployment:'NOT_DEPLOYED'};
  result.auditExceptionPolicySha256=auditExceptionPolicySha256;result.selectedAuditStatus=selectedAuditStatus;result.auditDecision=auditDecision;
  write('result.json',result);return result;
 }catch(error){write('failure.json',{status:'INCOMPLETE',code:error.message,deployment:'NOT_DEPLOYED'});throw error;}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  if(process.argv.length!==3)throw new Error('USE_NODE_verify-web-release-scope.mjs_NEW_EVIDENCE_DIRECTORY');
  console.log(JSON.stringify(runWebReleaseScope(process.cwd(),process.argv[2])));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
