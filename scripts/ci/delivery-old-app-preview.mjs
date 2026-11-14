import assert from 'node:assert/strict';
import {previewPublicOrigins} from './delivery-preview-deployment.mjs';

export const OLD_APP_SOURCE=Object.freeze({commit:'4e95d2ea5d53ae78c5af9c3db044481237674c44',
 tree:'73960312807aa3de72d3b0d8e6fbbd903a8bae09',
 packageSha256:'7cdea150954f48eea852a7a28e41a9687d19e0a2434847b863b51263140296b5',
 lockfileSha256:'6ed154029427a11e8ab9705de7d31cb11e6e6c522c66ad012457400430b0d160'});
const project='prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP',team='team_MMfsiG94K9Zy3e6w7Ccc9xY4',database='teunnvfakbfzmodajqjz';
const keys=(value,expected)=>assert.deepEqual(Object.keys(value).sort(),[...expected].sort());

// A source check only. A rebuilt old App is distinct from the original immutable
// Production deployment and still needs both actual backend compatibility phases.
export function verifyOldAppSource(value) {
 try {
  assert.deepEqual(value,{...OLD_APP_SOURCE,status:''});
  return {...OLD_APP_SOURCE,sourceVerified:true,originalArtifactEquivalent:false,releaseAuthorized:false};
 } catch {throw new Error('DELIVERY_OLD_APP_SOURCE_REJECTED');}
}
// Pure provider-response interpretation. The future protected producer/loader
// must authenticate source, run, build, runtime configuration and final readback.
// Metadata cannot prove App routing, original artifact equivalence or real usage.
export function verifyOldAppPreview({binding,deployment}) {
 try {
  keys(binding,['controlCommit','runId','deploymentId','url']);
  assert.match(binding.controlCommit??'',/^[a-f0-9]{40}$/);assert.match(binding.runId??'',/^[1-9][0-9]*$/);
  assert.match(binding.deploymentId??'',/^dpl_[A-Za-z0-9]+$/);
  const origin=previewPublicOrigins(binding.url);
  assert.equal(deployment.id,binding.deploymentId);assert.equal(deployment.projectId,project);
  const owners=[deployment.teamId,deployment.ownerId,deployment.team?.id].filter(v=>v!==undefined);
  assert.ok(owners.length>0&&owners.every(v=>v===team));
  assert.ok(deployment.target===null||deployment.target==='preview');assert.equal(deployment.readyState,'READY');
  assert.equal(previewPublicOrigins(deployment.url?.startsWith('https://')?deployment.url:'https://'+deployment.url),origin);
  for(const [key,value] of Object.entries({githubCommitSha:OLD_APP_SOURCE.commit,githubCommitRef:'main',
   stallorderCompatibilityPurpose:'delivery-old-app',stallorderCompatibilityRun:binding.runId,
   stallorderCompatibilityControl:binding.controlCommit,stallorderOldAppTree:OLD_APP_SOURCE.tree,
   stallorderOldAppLock:OLD_APP_SOURCE.lockfileSha256,stallorderCompatibilityDatabase:database}))assert.equal(deployment.meta?.[key],value);
  return {schema:'stallorder-old-app-preview-binding/v1',runtimeKind:'rebuilt-old-app-preview',
   project,team,database,...binding,url:origin,appCommit:OLD_APP_SOURCE.commit,appTree:OLD_APP_SOURCE.tree,
   lockfileSha256:OLD_APP_SOURCE.lockfileSha256,providerMetadataMatched:true,originVerified:false,
   originalArtifactEquivalent:false,backendCompatibilityVerified:false,mutationAuthorized:false,releaseAuthorized:false};
 } catch {throw new Error('DELIVERY_OLD_APP_PREVIEW_REJECTED');}
}
