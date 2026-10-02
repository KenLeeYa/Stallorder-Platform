import {resolve} from 'node:path';
import {readFileSync,writeFileSync} from 'node:fs';
import {prepareWebAudit,verifyWebArtifact,npmJson} from './lib/web-release-dependency-audit.mjs';
const root=process.cwd(),mode=process.argv[2],path=resolve(process.argv[3]??'.release-evidence/20261002/web-artifact-prebuild.json');
try{
 if(mode==='prepare'){
  const baseline=prepareWebAudit(root);writeFileSync(path,JSON.stringify(baseline,null,2)+'\n');console.log(JSON.stringify({scope:baseline.scope,prepared:true,head:baseline.head,sourceSha256:baseline.sourceSha256}));
 }else if(mode==='verify'){
  const rootAudit=npmJson(root,['audit','--workspaces=false','--json']);
  if(rootAudit.status!==0)throw new Error('WEB_ROOT_AUDIT_NON_PASS');
  const sbom=npmJson(root,['sbom','--sbom-format','cyclonedx','--workspaces=false','--package-lock-only']);
  if(sbom.status!==0)throw new Error('WEB_ROOT_SBOM_NON_PASS');
  const full=npmJson(root,['audit','--json']);
  const receipt=verifyWebArtifact(root,JSON.parse(readFileSync(path,'utf8')),rootAudit.value,sbom.value);
  receipt.fullRepositoryAudit={status:full.status===0?'PASS':'NON_PASS',vulnerabilities:full.value.metadata?.vulnerabilities??null};
  receipt.nativeRelease='NOT_AUTHORIZED_NOT_PUBLISHED';
  writeFileSync(path.replace(/\.json$/,'.result.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));process.exitCode=receipt.status==='PASS'?0:1;
 }else throw new Error('USE_prepare_OR_verify');
}catch(error){console.error(error.message);process.exitCode=1;}
