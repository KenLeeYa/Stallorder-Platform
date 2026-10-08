import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { assertTarget } from './qa-pr366-preview-ui.mjs';
import { capturePrimaryBaseline } from './qa-pr366-preview-binding.mjs';

export const SCOPE = Object.freeze({ repository: 'KenLeeYa/Stallorder-Platform', branch: 'codex/integrated-production-20261002', workflow: '.github/workflows/ephemeral-preview.yml', parent: 'eyuctbnlvnbnivwasvqr', team: 'team_MMfsiG94K9Zy3e6w7Ccc9xY4', project: 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP' });
export const REQUIRED_UI = [
 'isolated-seed-role-logins-and-cross-scope-denials', 'catalog-responsive-edit-cancel-return-mounted-save-failure', 'notification-navigation',
 'inbox-real-unread-read-persisted-and-owner-scope', 'inbox-mounted-unauthorized-clears-private-state', 'catalog-real-save-readback-return-restore',
 'dense-expense-mobile-more-collapse-full-desktop-summary', 'dense-schedule-mobile-more-collapse', 'dense-workforce-mobile-more-collapse',
 'dense-invoices-mobile-more-collapse', 'dense-supply-mobile-pagination-last-record', 'staff-toolbar-and-real-cash-pos-checkout',
 'inbox-real-membership-revocation-with-valid-session', 'inbox-real-session-revocation-clears-private-state', 'hosted-line-local-mock-denied'];
const fail = code => { throw Error(`EVIDENCE_${code}`); };
const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
const bound = (row,binding) => row && ['resourceKey','childRef','deploymentId','sha','tree'].every(key => row[key] === binding[key]);
const sorted = rows => [...rows].sort();
const phases = ['hours-open','hours-closed','hours-overnight','hours-cutoff','hours-preorder'];

export function verifySourceLineage(candidate, run, lineage) {
 if (candidate.repository !== SCOPE.repository || !/^[a-f0-9]{40}$/.test(candidate.sha ?? '') || !/^[a-f0-9]{40}$/.test(candidate.tree ?? '')) fail('SOURCE');
 if (candidate.branch === SCOPE.branch) {
  if (candidate.sha !== run.head_sha) fail('SOURCE');
  return {sourceValidationSHA:run.head_sha,sourceTree:candidate.tree,treeEquivalent:false,provenance:'EXACT_SOURCE'};
 }
 const pr=lineage?.pullRequest;
 if (candidate.branch !== 'staging' || !pr || pr.number !== 366 || pr.merged !== true || pr.head?.repo?.full_name !== SCOPE.repository || pr.head.ref !== SCOPE.branch || pr.head.sha !== run.head_sha || pr.base?.repo?.full_name !== SCOPE.repository || pr.base.ref !== 'staging' || pr.merge_commit_sha !== candidate.sha || lineage.sourceCommit?.sha !== run.head_sha || lineage.mergeCommit?.sha !== candidate.sha || lineage.sourceCommit?.tree?.sha !== candidate.tree || lineage.mergeCommit?.tree?.sha !== candidate.tree) fail('LINEAGE');
 return {sourceValidationSHA:run.head_sha,sourceTree:candidate.tree,treeEquivalent:true,provenance:{pullRequest:366,sourceSHA:run.head_sha,mergeSHA:pr.merge_commit_sha,base:'staging'}};
}

// Pure verification: provider observations and GitHub metadata are inputs, never inferred from a claimed PASS.
export function verifyDeploymentEvidence({ candidate, run, latestRun, jobs, artifacts, binding, baseline, cleanup, files, provider, lineage }) {
 const source = verifySourceLineage(candidate,run,lineage);
 if (run.repository?.full_name !== SCOPE.repository || run.head_repository?.full_name !== SCOPE.repository || run.path !== SCOPE.workflow || run.head_branch !== SCOPE.branch || run.head_sha !== source.sourceValidationSHA || run.event !== 'workflow_dispatch' || run.status !== 'completed' || run.conclusion !== 'success' || !Number.isSafeInteger(run.id) || run.run_attempt !== 1) fail('RUN');
 if (latestRun.id !== run.id || latestRun.run_attempt !== run.run_attempt || latestRun.head_sha !== source.sourceValidationSHA || latestRun.status !== 'completed' || latestRun.conclusion !== 'success') fail('LATEST_RUN');
 const job = jobs.find(row => row.name === 'validate');
 if (!job || job.head_sha !== source.sourceValidationSHA || job.run_id !== run.id || job.run_attempt !== run.run_attempt || job.status !== 'completed' || job.conclusion !== 'success') fail('VALIDATE_JOB');
 for (const name of ['Deploy matching Vercel Preview','Verify captured Preview deployment coordinates','Run isolated database tests','Lint isolated database','Capture fresh PR366 paired target and run browser QA before cleanup','Run matching Preview read-only smoke','Run isolated catalog translation glossary smoke','Run synthetic OAuth and delivery smoke tests','Clean exact manual Preview resources and verify absence']) {
  if (!job.steps?.some(step => step.name === name && step.status === 'completed' && step.conclusion === 'success')) fail('REQUIRED_STEP');
 }
 for (const name of [`pr366-browser-qa-${run.id}`,`manual-preview-final-${run.id}`]) {
  const matches = artifacts.filter(row => row.name === name);
  if (matches.length !== 1 || matches[0].expired !== false || matches[0].workflow_run?.id !== run.id || matches[0].workflow_run?.head_sha !== source.sourceValidationSHA) fail('ARTIFACT_OWNER');
 }
 if (cleanup.status !== 'CLEANED' || cleanup.resourceKey !== `manual-${run.id}` || cleanup.branchName !== cleanup.resourceKey || cleanup.gitBranch !== SCOPE.branch || cleanup.parent !== SCOPE.parent || cleanup.team !== SCOPE.team || cleanup.project !== SCOPE.project || cleanup.branches?.length !== 1 || cleanup.deployments?.length !== 1 || cleanup.branches[0].absent !== true || cleanup.deployments[0].absent !== true) fail('CLEANUP');
 if (binding.readback?.readyState !== 'READY') fail('HISTORICAL_READY');
 if (binding.sha !== source.sourceValidationSHA || binding.tree !== source.sourceTree || binding.resourceKey !== cleanup.resourceKey || binding.childRef !== cleanup.branches[0].id || binding.deploymentId !== cleanup.deployments[0].id) fail('BINDING');
 // Replay the historical binding at its actual timestamp, without treating a deleted resource as READY today.
 const verifiedAt = Date.parse(binding.readback?.verifiedAt);
 assertTarget({ ...cleanup, status: 'CAPTURED', branches: cleanup.branches.map(row => ({...row,absent:false})), deployments: cleanup.deployments.map(row => ({...row,absent:false})) }, binding, verifiedAt);
 if (baseline.projectId !== SCOPE.project || baseline.teamId !== SCOPE.team || baseline.provider !== 'VERCEL_TEAM_SCOPED_GET' || baseline.deploymentId === binding.deploymentId || !/^[a-f0-9]{40}$/.test(baseline.sha ?? '') || !Array.isArray(baseline.aliases) || binding.readback.primary?.deploymentId !== baseline.deploymentId || binding.readback.primary?.projectId !== baseline.projectId || !same(sorted(binding.readback.primary.aliases),sorted(baseline.aliases)) || !Array.isArray(binding.readback.aliases) || binding.readback.aliases.some(alias => !alias.endsWith('.vercel.app') || baseline.aliases.includes(alias))) fail('PRIMARY_BASELINE');
 const ui = files['ui-results.json'];
 if (!bound(ui,binding) || ui.complete !== false || !Array.isArray(ui.results) || new Set(ui.results.map(row => row.name)).size !== ui.results.length) fail('UI');
 for (const name of REQUIRED_UI) if (!ui.results.some(row => row.name === name && row.status === 'PASS')) fail('UI_CASE');
 const resolutions = {'public-hours-negative-http-phases':'SEPARATE_HOURS_PHASE_AND_DB_RECEIPTS_REQUIRED','midnight-deployed-db-calendar-boundaries':'SEPARATE_MIDNIGHT_ROLLBACK_DB_RECEIPT_REQUIRED'};
 for (const [name,reason] of Object.entries(resolutions)) if (!ui.results.some(row => row.name === name && row.status === 'PENDING' && row.reason === reason)) fail('UI_PHASE_PLACEHOLDER');
 for (const row of ui.results) {
  if (row.status === 'PASS' || (resolutions[row.name] === row.reason && row.status === 'PENDING')) continue;
  if (row.name === 'live-http-clock-midnight-transition' && row.status === 'NOT_RUN' && row.reason === 'EXPLICIT_DB_CLOCK_PROOF_DOES_NOT_CLAIM_LIVE_HTTP_TRANSITION') continue;
  fail('UI_PARTIAL');
 }
 for (const phase of phases) {
  const proof = files[`ui-${phase}.json`];
  if (!bound(proof,binding) || proof.phase !== phase || proof.status !== 'PASS' || proof.turnstile !== 'OFFICIAL_TEST_KEY_ONLY') fail('PHASE');
  if (phase === 'hours-preorder') { if (!proof.scheduledPickupAt || proof.quotedTotal !== proof.persistedTotal || !(proof.persistedTotal > 0)) fail('PREORDER'); }
  else if (proof.results?.length !== 2 || !['DEFAULT','DELIVERY'].every(mode => proof.results.some(row => row.mode === mode && (['hours-open','hours-overnight'].includes(phase) ? row.opened === true && row.created === true && row.quantity === 2 : phase === 'hours-cutoff' ? row.existingOrderUnchanged === true && row.code === 'QR_LAST_ORDER_PASSED' && !!row.rejectedCreateOrderId : row.increaseUnchanged === true && row.decreasedQuantity === 1 && !!row.rejectedCreateOrderId)))) fail('PHASE_CASE');
 }
 for (const [file,status] of [['fixture-inbox-readback.json','UI_READ_PERSISTED'],['fixture-inbox-membership-readback.json','DB_REVOKE_VERIFIED'],['fixture-verify-rejected-orders.json','READBACK_VERIFIED']]) if (!bound(files[file],binding) || files[file].status !== status) fail('DB_PROOF');
 const inbox=files['fixture-inbox-readback.json'], membership=files['fixture-inbox-membership-readback.json'], rejected=files['fixture-verify-rejected-orders.json'];
 if (!inbox.readReceiptId || !Number.isFinite(Date.parse(inbox.readAt)) || membership.kind !== 'INBOX_MEMBERSHIP_REVOKED' || membership.sessionStillValid !== true || membership.ownerStillAuthorized !== true || membership.privateStateCleared !== true || rejected.kind !== 'CLOSED_ORDER_REJECTION' || rejected.retainedQuantity !== 1 || rejected.retainedOrderIds?.length !== 2 || new Set(rejected.retainedOrderIds).size !== 2 || rejected.rejectedOrderIds?.length !== 2 || new Set(rejected.rejectedOrderIds).size !== 2 || rejected.retainedOrderIds.some(id=>rejected.rejectedOrderIds.includes(id)) || !same(rejected.retainedOrderIds,files['ui-hours-closed.json'].orderIds) || !same(rejected.rejectedOrderIds,files['ui-hours-closed.json'].results.map(row=>row.rejectedCreateOrderId))) fail('DB_FACTS');
 const midnight = files['fixture-midnight-rollback.json'];
 const midnightExpected = {before_open:'STALL_CLOSED',opens_inclusive:null,before_midnight:null,after_midnight_today_closed:null,overnight_tail:null,closes_exclusive:'STALL_CLOSED',before_overnight_cutoff:null,overnight_cutoff_inclusive:'QR_LAST_ORDER_PASSED',special_closed_date_overrides_yesterday_tail:'STALL_SPECIAL_CLOSURE'};
 const midnightCases = Object.keys(midnightExpected);
 if (!bound(midnight,binding) || midnight.kind !== 'MIDNIGHT_DB_CALENDAR' || midnight.status !== 'PASS' || midnight.rolledBack !== true || midnight.originalHoursUnchanged !== true || midnight.closureAbsent !== true || midnight.results?.length !== 18 || !midnight.results.every(row => row.passed === true && row.actual === midnightExpected[row.caseName] && row.expected === midnightExpected[row.caseName]) || !['DEFAULT','DELIVERY'].every(mode => midnightCases.every(caseName => midnight.results.filter(row => row.mode === mode && row.caseName === caseName).length === 1))) fail('MIDNIGHT');
 if (provider.deploymentStatus !== 404 || provider.childAbsent !== true || provider.parent !== SCOPE.parent || provider.project !== SCOPE.project || provider.team !== SCOPE.team || !/^[a-f0-9]{64}$/.test(baseline.publicBackendConfigFingerprint ?? '') || provider.publicBackendConfigFingerprint !== baseline.publicBackendConfigFingerprint || !same(provider.primary, {projectId:baseline.projectId,teamId:baseline.teamId,deploymentId:baseline.deploymentId,sha:baseline.sha,aliases:sorted(baseline.aliases)})) fail('PROVIDER_DRIFT');
 return {status:'VERIFIED',checkOwner:'repository-owned GitHub Actions',dispatchSHA:candidate.sha,sourceValidationSHA:source.sourceValidationSHA,treeEquivalent:source.treeEquivalent,provenance:source.provenance,sha:candidate.sha,tree:candidate.tree,sourceRunId:run.id,sourceRunAttempt:run.run_attempt,sourceRunUrl:`https://github.com/${SCOPE.repository}/actions/runs/${run.id}`,resourceKey:binding.resourceKey,childRef:binding.childRef,deploymentId:binding.deploymentId,historicalHostedValidation:'PASSED',currentDeployment:'ABSENT_404',child:'ABSENT',primary:'UNCHANGED',publicProjectConfigurationUnchanged:true,immutablePrimaryDeploymentMatched:true,backendVerificationScope:'UNCHANGED_PUBLIC_PROJECT_CONFIGURATION_AND_IMMUTABLE_DEPLOYMENT; NOT_FRESH_SERVER_DATABASE_BINDING',excludedScope:['live-http-clock-midnight-transition'],artifactIds:artifacts.filter(row => [`pr366-browser-qa-${run.id}`,`manual-preview-final-${run.id}`].includes(row.name)).map(row=>row.id)};
}

export async function captureProviderReadback(binding,baseline,{api,branches}) {
 const deleted = await api(`/v13/deployments/${encodeURIComponent(binding.deploymentId)}?teamId=${SCOPE.team}`,true);
 const children = await branches(SCOPE.parent);
 if (!Array.isArray(children)) fail('CHILD_READBACK');
 const primary = await capturePrimaryBaseline(baseline,api);
 return {publicBackendConfigFingerprint:primary.publicBackendConfigFingerprint,deploymentStatus:deleted === null ? 404 : 200,childAbsent:!children.some(row => row.project_ref === binding.childRef || row.name === binding.resourceKey),parent:SCOPE.parent,project:SCOPE.project,team:SCOPE.team,primary:{projectId:primary.projectId,teamId:primary.teamId,deploymentId:primary.deploymentId,sha:primary.sha,aliases:sorted(primary.aliases)}};
}

// An empty jobs response cannot prove that a newer run was only cleanup or verification.
export async function selectLatestValidationRun(runs, jobsForRun) {
 for (const row of runs) {
  const attempt = await jobsForRun(row);
  if (!attempt.jobs?.length) fail('NEWER_UNCLASSIFIED_RUN');
  if (attempt.total_count > 100) fail('JOB_PAGINATION');
  if (attempt.jobs.some(job => job.name === 'validate' && job.conclusion !== 'skipped')) return row;
 }
 fail('LATEST_RUN');
}

async function main() {
 const [id,dir,output] = process.argv.slice(2);
 if (!/^[1-9]\d*$/.test(id ?? '') || !dir || !output || process.argv.length !== 5 || !process.env.GH_TOKEN || !process.env.VERCEL_TOKEN || !process.env.SUPABASE_ACCESS_TOKEN) fail('ARGUMENTS');
 const candidate = {repository:process.env.GITHUB_REPOSITORY,branch:process.env.GITHUB_REF_NAME,sha:process.env.GITHUB_SHA,tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim()};
 if (execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim() !== candidate.sha || candidate.repository !== SCOPE.repository || ![SCOPE.branch,'staging'].includes(candidate.branch)) fail('CHECKOUT');
 const get = async (host,path,token,allow404=false) => {
  const response = await fetch(`${host}${path}`,{headers:{Authorization:`Bearer ${token}`,Accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(30000)});
  if (allow404 && response.status === 404) return null;
  if (!response.ok) fail('PROVIDER_READ');
  return response.json();
 };
 const gh = path => get('https://api.github.com',`/repos/${SCOPE.repository}${path}`,process.env.GH_TOKEN);
 const run = await gh(`/actions/runs/${id}`);
 let lineage;
 if (candidate.branch === 'staging') {
  lineage={pullRequest:await gh('/pulls/366'),sourceCommit:await gh(`/git/commits/${run.head_sha}`),mergeCommit:await gh(`/git/commits/${candidate.sha}`)};
 }
 verifySourceLineage(candidate,run,lineage);
 const listed = await gh(`/actions/workflows/ephemeral-preview.yml/runs?branch=${encodeURIComponent(SCOPE.branch)}&head_sha=${run.head_sha}&event=workflow_dispatch&per_page=100`);
 const latestRun = await selectLatestValidationRun(listed.workflow_runs ?? [], row => gh(`/actions/runs/${row.id}/attempts/${row.run_attempt}/jobs?per_page=100`));
 const jobs = await gh(`/actions/runs/${id}/attempts/${run.run_attempt}/jobs?per_page=100`);
 const artifacts = await gh(`/actions/runs/${id}/artifacts?per_page=100`);
 if (jobs.total_count > 100 || artifacts.total_count > 100) fail('PAGINATION');
 const browser = resolve(dir,`pr366-browser-qa-${id}`);
 const read = path => JSON.parse(readFileSync(path,'utf8'));
 const binding = read(resolve(browser,'ui-binding.json')), baseline=read(resolve(browser,'primary-baseline.json'));
 const cleanup = read(resolve(dir,`manual-preview-final-${id}`,'manual-resources.json'));
 const names = ['ui-results.json',...phases.map(phase=>`ui-${phase}.json`),'fixture-inbox-readback.json','fixture-inbox-membership-readback.json','fixture-verify-rejected-orders.json','fixture-midnight-rollback.json'];
 const files = Object.fromEntries(names.map(name => [name,read(resolve(browser,'pr366-ui',name))]));
 const provider = await captureProviderReadback(binding,baseline,{api:(path,allow404)=>get('https://api.vercel.com',path,process.env.VERCEL_TOKEN,allow404),branches:parent=>JSON.parse(execFileSync('supabase',['branches','list','--project-ref',parent,'--output','json','--log-level','error'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000}))});
 const result=verifyDeploymentEvidence({candidate,run,latestRun,jobs:jobs.jobs,artifacts:artifacts.artifacts,binding,baseline,cleanup,files,provider,lineage});
 writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});
 console.log('EVIDENCE_VERIFIED');
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main().catch(error=>{ console.error(/^EVIDENCE_[A-Z_]+$/.test(error.message)?error.message:'EVIDENCE_VERIFICATION_FAILED');process.exitCode=1; });
