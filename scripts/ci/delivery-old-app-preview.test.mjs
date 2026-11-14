import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyOldAppSource,verifyOldAppPreview} from './delivery-old-app-preview.mjs';
const commit='4e95d2ea5d53ae78c5af9c3db044481237674c44',tree='73960312807aa3de72d3b0d8e6fbbd903a8bae09';
const lock='6ed154029427a11e8ab9705de7d31cb11e6e6c522c66ad012457400430b0d160';
const source=()=>({commit,tree,status:'',packageSha256:'7cdea150954f48eea852a7a28e41a9687d19e0a2434847b863b51263140296b5',lockfileSha256:lock});
function fixture() {
 const binding={controlCommit:'a'.repeat(40),runId:'123',deploymentId:'dpl_SyntheticOldApp',
  url:'https://stallorder-platform-oldtest-ada76145-8663s-projects.vercel.app'};
 const deployment={id:binding.deploymentId,projectId:'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP',
  ownerId:'team_MMfsiG94K9Zy3e6w7Ccc9xY4',url:binding.url.slice(8),target:null,readyState:'READY',
  meta:{githubCommitSha:commit,githubCommitRef:'main',stallorderCompatibilityPurpose:'delivery-old-app',
   stallorderCompatibilityRun:binding.runId,stallorderCompatibilityControl:binding.controlCommit,
   stallorderOldAppTree:tree,stallorderOldAppLock:lock,stallorderCompatibilityDatabase:'teunnvfakbfzmodajqjz'}};
 return {binding,deployment};
}
test('old source is exact and independent from the frozen candidate source',()=>{
 const result=verifyOldAppSource(source());assert.equal(result.commit,commit);
 assert.equal(result.sourceVerified,true);assert.equal(result.originalArtifactEquivalent,false);assert.equal(result.releaseAuthorized,false);
});
for(const [name,edit] of [['candidate source',s=>s.commit='0d2b27144fcf589bb887e669c09e82158e3de7a2'],
 ['tree',s=>s.tree='b'.repeat(40)],['dirty source',s=>s.status=' M app.ts'],['lockfile',s=>s.lockfileSha256='b'.repeat(64)],
 ['package',s=>s.packageSha256='b'.repeat(64)],['extra field',s=>s.password='PRIVATE-MARKER']])
 test('source rejects '+name+' without raw assertion details',()=>{
  const s=source();edit(s);assert.throws(()=>verifyOldAppSource(s),e=>e.message==='DELIVERY_OLD_APP_SOURCE_REJECTED'&&!('actual'in e));
 });
test('a separate old Preview receipt never claims original artifact or backend acceptance',()=>{
 const out=verifyOldAppPreview(fixture());assert.equal(out.runtimeKind,'rebuilt-old-app-preview');
 assert.equal(out.appCommit,commit);assert.equal(out.appTree,tree);assert.equal(out.lockfileSha256,lock);
 for(const field of ['originVerified','originalArtifactEquivalent','backendCompatibilityVerified','mutationAuthorized','releaseAuthorized'])assert.equal(out[field],false);
});
for(const [name,edit] of [['production target',f=>f.deployment.target='production'],['foreign team',f=>f.deployment.ownerId='foreign'],
 ['conflicting owner',f=>f.deployment.teamId='foreign'],['foreign project',f=>f.deployment.projectId='foreign'],
 ['candidate commit',f=>f.deployment.meta.githubCommitSha='0d2b27144fcf589bb887e669c09e82158e3de7a2'],
 ['wrong tree',f=>f.deployment.meta.stallorderOldAppTree='b'.repeat(40)],['wrong lock',f=>f.deployment.meta.stallorderOldAppLock='b'.repeat(64)],
 ['wrong run',f=>f.deployment.meta.stallorderCompatibilityRun='124'],['wrong control',f=>f.deployment.meta.stallorderCompatibilityControl='b'.repeat(40)],
 ['primary backend',f=>f.deployment.meta.stallorderCompatibilityDatabase='eyuctbnlvnbnivwasvqr'],
 ['wrong purpose',f=>f.deployment.meta.stallorderCompatibilityPurpose='candidate'],['unready',f=>f.deployment.readyState='BUILDING'],
 ['wrong URL',f=>f.deployment.url='app.qidaigo.com'],['foreign deployment',f=>f.deployment.id='dpl_Other'],
 ['credential URL',f=>f.binding.url=f.binding.url.replace('https://','https://secret@')],
 ['extra binding',f=>f.binding.private='PRIVATE-MARKER']])
 test('old Preview rejects '+name,()=>{const f=fixture();edit(f);assert.throws(()=>verifyOldAppPreview(f),
  e=>e.message==='DELIVERY_OLD_APP_PREVIEW_REJECTED'&&!('actual'in e)&&!JSON.stringify(e).includes('PRIVATE-MARKER'));});
