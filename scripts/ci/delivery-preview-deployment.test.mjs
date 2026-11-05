import test from 'node:test';
import assert from 'node:assert/strict';
import {verifyPreviewDeployment,previewPublicOrigins} from './delivery-preview-deployment.mjs';
const binding={project:'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP',team:'team_MMfsiG94K9Zy3e6w7Ccc9xY4',runId:'12345',commit:'0d2b27144fcf589bb887e669c09e82158e3de7a2',id:'dpl_test',url:'https://stallorder-platform-test123-ada76145-8663s-projects.vercel.app'};
const deployment=()=>({id:binding.id,url:new URL(binding.url).host,projectId:binding.project,teamId:binding.team,target:null,readyState:'READY',meta:{githubCommitSha:binding.commit,githubCommitRef:'codex/conversion-source-checks-20261023',stallorderPreviewRun:binding.runId,stallorderPreviewResource:'pr-389'}});
test('binds the exact product to one provider-readback Preview origin',()=>{assert.equal(verifyPreviewDeployment(binding,deployment()),binding.url);});
for(const [name,mutate] of [
 ['id',d=>d.id='dpl_other'],['origin',d=>d.url=d.url.replace('test123','other')],['project',d=>d.projectId='other'],['team',d=>d.teamId='other'],['production target',d=>d.target='production'],['state',d=>d.readyState='BUILDING'],['source',d=>d.meta.githubCommitSha='a'.repeat(40)],['run',d=>d.meta.stallorderPreviewRun='7'],['branch',d=>d.meta.githubCommitRef='main'],['resource',d=>d.meta.stallorderPreviewResource='other']
])test('rejects deployment drift: '+name,()=>{const d=deployment();mutate(d);assert.throws(()=>verifyPreviewDeployment(binding,d));});
test('origin supports localhost bootstrap or one canonical provider-bound Preview only',()=>{assert.equal(previewPublicOrigins(), 'http://127.0.0.1:3000');assert.equal(previewPublicOrigins(binding.url),binding.url);});
for(const url of ['https://app.qidaigo.com','https://stallorder-platform-evil.vercel.app',binding.url+'/path',binding.url+'?x=1',binding.url+'#x',binding.url.replace('https://','http://'),binding.url.replace('https://','https://x@'),binding.url.replace('.app','.app:443'),binding.url+'\n'])test('refuses unsafe origin '+JSON.stringify(url),()=>assert.throws(()=>previewPublicOrigins(url)));
