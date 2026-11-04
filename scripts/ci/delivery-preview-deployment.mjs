import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const project='prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP';
const team='team_MMfsiG94K9Zy3e6w7Ccc9xY4';
const commit='b9a98a0bff0490c04b2295e4bcfb2b7781774c91';
export function previewPublicOrigins(value){
 if(value===undefined)return 'http://127.0.0.1:3000';
 assert.ok(typeof value==='string'&&!/[\x00-\x1f\x7f]/.test(value),'PREVIEW_ORIGIN_INVALID');
 const u=new URL(value);assert.equal(u.protocol,'https:');assert.equal(u.origin,value);
 assert.match(u.hostname,/^stallorder-platform-[a-z0-9]+-ada76145-8663s-projects\.vercel\.app$/);
 return u.origin;
}
export function verifyPreviewDeployment(binding,d){
 assert.equal(binding.project,project);assert.equal(binding.team,team);assert.equal(binding.commit,commit);
 assert.match(binding.runId??'',/^[1-9][0-9]*$/);assert.match(binding.id??'',/^dpl_[a-zA-Z0-9]+$/);
 const origin=previewPublicOrigins(binding.url);
 assert.equal(d.id,binding.id);assert.equal(d.projectId,project);
 const owners=[d.teamId,d.ownerId,d.team?.id].filter(v=>v!==undefined);
 assert.ok(owners.length>0&&owners.every(v=>v===team),'PREVIEW_ACCOUNT_MISMATCH');
 assert.ok(d.target===null||d.target==='preview');assert.equal(d.readyState,'READY');
 assert.equal(previewPublicOrigins(d.url?.startsWith('https://')?d.url:'https://'+d.url),origin);
 for(const [key,value] of Object.entries({githubCommitSha:commit,githubCommitRef:'codex/conversion-source-checks-20261023',stallorderPreviewRun:binding.runId,stallorderPreviewResource:'pr-389'}))assert.equal(d.meta?.[key],value);
 return origin;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  assert.equal(process.env.GITHUB_REPOSITORY,'KenLeeYa/Stallorder-Platform');
  const bytes=readFileSync(0);assert.ok(bytes.length<=2*1024*1024);
  const d=JSON.parse(bytes);
  console.log(verifyPreviewDeployment({project:process.env.VERCEL_PROJECT_ID,team:process.env.VERCEL_ORG_ID,
   commit:process.env.DELIVERY_PRODUCT_COMMIT,runId:process.env.GITHUB_RUN_ID,
   id:process.env.DELIVERY_DEPLOYMENT_ID,url:process.env.DELIVERY_DEPLOYMENT_URL},d));
 }catch{console.error('PREVIEW_DEPLOYMENT_BINDING_FAILED');process.exitCode=1;}
}
