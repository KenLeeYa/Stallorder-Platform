import { test } from 'vitest';
import assert from 'node:assert/strict';
import { SCOPE, REQUIRED_UI, verifyDeploymentEvidence, captureProviderReadback, selectLatestValidationRun } from './verify-pr366-deployment-evidence.mjs';
function fixture() {
 const sha='a'.repeat(40), tree='b'.repeat(40), resourceKey='manual-37714174760', childRef='abcdefghijklmnopqrst', deploymentId='dpl_preview';
 const baseline={projectId:SCOPE.project,teamId:SCOPE.team,deploymentId:'dpl_primary',sha:'c'.repeat(40),aliases:['app.qidaigo.com'],provider:'VERCEL_TEAM_SCOPED_GET',publicBackendConfigFingerprint:'f'.repeat(64)};
 const cleanup={status:'CLEANED',resourceKey,branchName:resourceKey,gitBranch:SCOPE.branch,parent:SCOPE.parent,team:SCOPE.team,project:SCOPE.project,expiresAt:'2026-10-08T09:00:00Z',branches:[{id:childRef,absent:true}],deployments:[{id:deploymentId,target:'preview',absent:true}]};
 const origin='https://test.vercel.app';
 const binding={origin,resourceKey,childRef,deploymentId,sha,tree,providerReadback:'VERIFIED',productionAlias:false,dataLess:true,readback:{readyState:'READY',verifiedAt:'2026-10-08T07:00:00Z',child:{project_ref:childRef,name:resourceKey,with_data:false,git_branch:SCOPE.branch,parent_project_ref:SCOPE.parent},childScope:{provider:'supabase-cli',operation:'branches list',parentProjectRef:SCOPE.parent},deployment:{id:deploymentId,projectId:SCOPE.project,teamId:SCOPE.team,target:'preview',origin,meta:{stallorderPreviewResource:resourceKey,githubCommitRef:SCOPE.branch,githubCommitSha:sha}},source:{sha,tree},aliases:[],primary:{projectId:SCOPE.project,deploymentId:baseline.deploymentId,aliases:baseline.aliases}}};
 const run={id:37714174760,run_attempt:1,repository:{full_name:SCOPE.repository},head_repository:{full_name:SCOPE.repository},path:SCOPE.workflow,head_branch:SCOPE.branch,head_sha:binding.sha,event:'workflow_dispatch',status:'completed',conclusion:'success'};
 const identity=Object.fromEntries(['resourceKey','childRef','deploymentId','sha','tree'].map(key=>[key,binding[key]]));
 const ui={...identity,complete:false,results:REQUIRED_UI.map(name=>({name,status:'PASS'}))};
 ui.results.push({name:'public-hours-negative-http-phases',status:'PENDING',reason:'SEPARATE_HOURS_PHASE_AND_DB_RECEIPTS_REQUIRED'},{name:'midnight-deployed-db-calendar-boundaries',status:'PENDING',reason:'SEPARATE_MIDNIGHT_ROLLBACK_DB_RECEIPT_REQUIRED'},{name:'live-http-clock-midnight-transition',status:'NOT_RUN',reason:'EXPLICIT_DB_CLOCK_PROOF_DOES_NOT_CLAIM_LIVE_HTTP_TRANSITION'});
 const files={'ui-results.json':ui};
 // Match each actual harness writer shape; cutoff has no quantity-edit proof.
 for(const phase of ['hours-open','hours-closed','hours-overnight','hours-cutoff']) files[`ui-${phase}.json`]={...identity,phase,status:'PASS',complete:false,turnstile:'OFFICIAL_TEST_KEY_ONLY',pending:['EXACT_MIDNIGHT_BOUNDARY_FUTURE_PREORDER_DEVICE_UI'],orderIds:['one','two'],results:['DEFAULT','DELIVERY'].map(mode=>{
  const rejectedCreateOrderId=mode==='DEFAULT'?'rejected-one':'rejected-two';
  if(['hours-open','hours-overnight'].includes(phase))return {mode,opened:true,created:true,quantity:2};
  if(phase==='hours-cutoff')return {mode,rejectedCreateOrderId,existingOrderUnchanged:true,code:'QR_LAST_ORDER_PASSED'};
  return {mode,rejectedCreateOrderId,increaseUnchanged:true,decreasedQuantity:1};
 })};
 files['ui-hours-preorder.json']={...identity,phase:'hours-preorder',status:'PASS',complete:false,orderIds:['preorder'],turnstile:'OFFICIAL_TEST_KEY_ONLY',quoteSource:'ACTUAL_ORDER_SESSION_MENU_AND_CANONICAL_SLOTS',pending:['EXACT_MIDNIGHT_BOUNDARY_DEVICE_UI'],scheduledPickupAt:'2026-10-09T02:00:00Z',quotedTotal:100,persistedTotal:100};
 for(const [name,status] of [['inbox-readback','UI_READ_PERSISTED'],['inbox-membership-readback','DB_REVOKE_VERIFIED'],['verify-rejected-orders','READBACK_VERIFIED']]) files[`fixture-${name}.json`]={...identity,status};
 Object.assign(files['fixture-inbox-readback.json'],{readReceiptId:'read',readAt:'2026-10-08T07:00:00Z'});
 Object.assign(files['fixture-inbox-membership-readback.json'],{kind:'INBOX_MEMBERSHIP_REVOKED',sessionStillValid:true,ownerStillAuthorized:true,privateStateCleared:true});
 Object.assign(files['fixture-verify-rejected-orders.json'],{kind:'CLOSED_ORDER_REJECTION',retainedQuantity:1,retainedOrderIds:['one','two'],rejectedOrderIds:['rejected-one','rejected-two']});
 files['fixture-midnight-rollback.json']={...identity,kind:'MIDNIGHT_DB_CALENDAR',status:'PASS',rolledBack:true,originalHoursUnchanged:true,closureAbsent:true,results:['DEFAULT','DELIVERY'].flatMap(mode=>['before_open','opens_inclusive','before_midnight','after_midnight_today_closed','overnight_tail','closes_exclusive','before_overnight_cutoff','overnight_cutoff_inclusive','special_closed_date_overrides_yesterday_tail'].map(caseName=>{const expected=({before_open:'STALL_CLOSED',closes_exclusive:'STALL_CLOSED',overnight_cutoff_inclusive:'QR_LAST_ORDER_PASSED',special_closed_date_overrides_yesterday_tail:'STALL_SPECIAL_CLOSURE'})[caseName]??null;return {mode,caseName,actual:expected,expected,passed:true};}))};
 const jobs=[{name:'validate',head_sha:binding.sha,run_id:run.id,run_attempt:1,status:'completed',conclusion:'success',steps:['Deploy matching Vercel Preview','Verify captured Preview deployment coordinates','Run isolated database tests','Lint isolated database','Capture fresh PR366 paired target and run browser QA before cleanup','Run matching Preview read-only smoke','Run isolated catalog translation glossary smoke','Run synthetic OAuth and delivery smoke tests','Clean exact manual Preview resources and verify absence'].map(name=>({name,status:'completed',conclusion:'success'}))}];
 const artifacts=[`pr366-browser-qa-${run.id}`,`manual-preview-final-${run.id}`].map((name,id)=>({name,id,expired:false,workflow_run:{id:run.id,head_sha:binding.sha}}));
 const provider={publicBackendConfigFingerprint:baseline.publicBackendConfigFingerprint,deploymentStatus:404,childAbsent:true,parent:SCOPE.parent,project:SCOPE.project,team:SCOPE.team,primary:{projectId:baseline.projectId,teamId:baseline.teamId,deploymentId:baseline.deploymentId,sha:baseline.sha,aliases:[...baseline.aliases].sort()}};
 return {candidate:{repository:SCOPE.repository,branch:SCOPE.branch,sha:binding.sha,tree:binding.tree},run,latestRun:{...run},jobs,artifacts,binding,baseline,cleanup,files,provider};
}
test('synthetic complete fixture resolves separately bound phases without claiming current READY or live midnight',()=>{
 const result=verifyDeploymentEvidence(fixture()); assert.equal(result.status,'VERIFIED');assert.equal(result.currentDeployment,'ABSENT_404');assert.deepEqual(result.excludedScope,['live-http-clock-midnight-transition']);
});
for(const [name,mutate] of [
 ['failed hosted run',f=>f.run.conclusion='failure'],['wrong SHA',f=>f.candidate.sha='d'.repeat(40)],['wrong tree',f=>f.candidate.tree='a'.repeat(40)],
 ['historical READY missing',f=>delete f.binding.readback.readyState],['historical READY failed',f=>f.binding.readback.readyState='ERROR'],['foreign repo',f=>f.run.repository.full_name='attacker/repo'],['foreign artifact',f=>f.artifacts[0].workflow_run.id=99],['rerun ambiguity',f=>f.run.run_attempt=2],
 ['newer failed same-head validation',f=>{f.latestRun.id++;f.latestRun.conclusion='failure';}],['missing required UI',f=>f.files['ui-results.json'].results.shift()],
 ['pending required UI',f=>f.files['ui-results.json'].results[0].status='PENDING'],['extra skipped UI',f=>f.files['ui-results.json'].results.push({name:'unexpected',status:'SKIPPED'})],
 ['missing DB proof',f=>delete f.files['fixture-inbox-readback.json']],['wrong DB owner',f=>f.files['fixture-midnight-rollback.json'].resourceKey='manual-123'],
 ['cutoff missing unchanged proof',f=>delete f.files['ui-hours-cutoff.json'].results[0].existingOrderUnchanged],['cutoff wrong denial',f=>f.files['ui-hours-cutoff.json'].results[0].code='STALL_CLOSED'],['cutoff closed-phase shape',f=>f.files['ui-hours-cutoff.json'].results=f.files['ui-hours-closed.json'].results],['partial phase',f=>f.files['ui-hours-closed.json'].results.pop()],['failed phase',f=>f.files['ui-hours-open.json'].status='FAIL'],
 ['forged mutually equal midnight expectation',f=>{f.files['fixture-midnight-rollback.json'].results[0].actual=null;f.files['fixture-midnight-rollback.json'].results[0].expected=null;}],['partial midnight',f=>f.files['fixture-midnight-rollback.json'].results.pop()],['cleanup recovery required',f=>f.cleanup.status='RECOVERY_REQUIRED'],
 ['extra owned deployment',f=>f.cleanup.deployments.push({...f.cleanup.deployments[0],id:'dpl_other'})],['deployment remains',f=>f.provider.deploymentStatus=200],
 ['child remains',f=>f.provider.childAbsent=false],['baseline fingerprint absent',f=>delete f.baseline.publicBackendConfigFingerprint],['baseline fingerprint malformed',f=>f.baseline.publicBackendConfigFingerprint='fake'],['Primary backend changed',f=>f.provider.publicBackendConfigFingerprint='e'.repeat(64)],['Primary source changed',f=>f.provider.primary.sha='a'.repeat(40)],
 ['Primary aliases changed',f=>f.provider.primary.aliases.push('other.example')],['historical production alias',f=>f.binding.readback.aliases.push('app.qidaigo.com')],
 ['missing required smoke',f=>f.jobs[0].steps[3].conclusion='skipped']
]) test(`fails closed: ${name}`,()=>{const f=fixture();mutate(f);assert.throws(()=>verifyDeploymentEvidence(f));});
test('fresh provider adapter uses exact team-scoped deployment and parent list, read only',async()=>{
 const f=fixture(),calls=[];
 const result=await captureProviderReadback(f.binding,f.baseline,{branches:async parent=>{assert.equal(parent,SCOPE.parent);return [];},api:async(path,missing)=>{
  calls.push(path); if(missing)return null;
  assert(!path.includes('/env/'), 'single encrypted or decrypted secret read is forbidden');
  if(path.includes('/env?'))return {envs:[{id:'env_public',key:'NEXT_PUBLIC_SUPABASE_URL',type:'sensitive',target:['production'],updatedAt:123,value:'synthetic-encrypted-value'}]};
  if(path.startsWith('/v9/projects/'))return {id:SCOPE.project,accountId:SCOPE.team,targets:{production:{id:f.baseline.deploymentId}}};
  if(path.includes('/aliases?'))return {aliases:f.baseline.aliases.map(alias=>({alias}))};
  return {id:f.baseline.deploymentId,projectId:SCOPE.project,target:'production',readyState:'READY',meta:{githubCommitSha:f.baseline.sha}};
 }});
 assert.equal(result.deploymentStatus,404);assert.match(result.publicBackendConfigFingerprint,/^[a-f0-9]{64}$/);assert(!JSON.stringify(result).includes('synthetic-encrypted-value'));assert(calls.every(path=>path.includes(`teamId=${SCOPE.team}`)));assert(calls[0].includes(f.binding.deploymentId));
});


for (const status of ['queued','completed','cancelled']) test(`latest selector refuses newer ${status} empty-jobs run`,async()=>{
 await assert.rejects(selectLatestValidationRun([{id:2,status},{id:1,status:'completed'}],async row=>row.id===2?{jobs:[],total_count:0}:{jobs:[{name:'validate',conclusion:'success'}],total_count:1}),/EVIDENCE_NEWER_UNCLASSIFIED_RUN/);
});
test('latest selector skips classified verification and returns newer failed validation',async()=>{
 const result=await selectLatestValidationRun([{id:3},{id:2},{id:1}],async row=>({jobs:[{name:'validate',conclusion:row.id===3?'skipped':row.id===2?'failure':'success'}],total_count:1}));
 assert.equal(result.id,2);
});
function stagingFixture() {
 const f=fixture(), mergeSHA='d'.repeat(40);
 f.candidate={...f.candidate,branch:'staging',sha:mergeSHA};
 f.lineage={pullRequest:{number:366,merged:true,head:{repo:{full_name:SCOPE.repository},ref:SCOPE.branch,sha:f.run.head_sha},base:{repo:{full_name:SCOPE.repository},ref:'staging'},merge_commit_sha:mergeSHA},sourceCommit:{sha:f.run.head_sha,tree:{sha:f.candidate.tree}},mergeCommit:{sha:mergeSHA,tree:{sha:f.candidate.tree}}};
 return f;
}
test('exact merged PR366 staging lineage carries source evidence with identical GitHub trees',()=>{
 const f=stagingFixture(), result=verifyDeploymentEvidence(f);
 assert.equal(result.dispatchSHA,f.candidate.sha);assert.equal(result.sourceValidationSHA,f.run.head_sha);assert.equal(result.treeEquivalent,true);assert.equal(result.provenance.pullRequest,366);
});
for (const [name,mutate] of [
 ['foreign head repository',f=>f.lineage.pullRequest.head.repo.full_name='foreign/repo'],
 ['foreign head branch',f=>f.lineage.pullRequest.head.ref='arbitrary'],
 ['foreign base repository',f=>f.lineage.pullRequest.base.repo.full_name='foreign/repo'],
 ['wrong base branch',f=>f.lineage.pullRequest.base.ref='main'],
 ['unmerged PR366',f=>f.lineage.pullRequest.merged=false],
 ['different merge commit',f=>f.lineage.pullRequest.merge_commit_sha='e'.repeat(40)],
 ['changed GitHub source tree',f=>f.lineage.sourceCommit.tree.sha='e'.repeat(40)],
 ['changed GitHub merge tree',f=>f.lineage.mergeCommit.tree.sha='e'.repeat(40)],
 ['newer staging HEAD',f=>f.candidate.sha='e'.repeat(40)],
 ['changed PR source SHA',f=>f.lineage.pullRequest.head.sha='e'.repeat(40)],
 ['arbitrary main dispatch',f=>f.candidate.branch='main'],
 ['wrong PR number',f=>f.lineage.pullRequest.number=367]
]) test(`lineage fails closed: ${name}`,()=>{const f=stagingFixture();mutate(f);assert.throws(()=>verifyDeploymentEvidence(f),/EVIDENCE_LINEAGE/);});
