import {spawn} from 'node:child_process';
import {loadEnvFile} from 'node:process';
import {writeFileSync,existsSync,openSync,closeSync} from 'node:fs';
import {createServer} from 'node:net';
import {openGuardedDatabase,verifyLiveFixture} from '../../../docs/awesome-optimization/qa/live-fixture-guard.mjs';
import {readResponsiveBuildProvenance} from '../../responsive-build-provenance.mjs';
loadEnvFile('.env.local');
const label=process.argv[2]??'first';if(!/^[a-z0-9-]+$/.test(label))throw Error('BATCH4A_RUNTIME_LABEL_INVALID');
const receipt=`.superpowers/sdd/2026-10-01-awesome-optimization/batch-4a/runtime-${label}.json`;
if(existsSync(receipt))throw Error('BATCH4A_RUNTIME_RECEIPT_EXISTS');
if(!process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256)throw Error('BATCH4A_EXPECTED_SOURCE_LITERAL_REQUIRED');
const source=readResponsiveBuildProvenance({expectedSourceSha256:process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256});
const db=await openGuardedDatabase();const corpus=(await verifyLiveFixture(db)).receipt;await db.$disconnect();
await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',()=>reject(Error('BATCH4A_APP_PORT_IN_USE')));probe.listen(3026,'127.0.0.1',()=>probe.close(resolve));});
const receiptFd=openSync(receipt,'wx');
let child;
let startupError;
try {
try {
await new Promise((resolve,reject)=>{
child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3026'],{env:{...process.env,APP_BASE_URL:'http://127.0.0.1:3026',NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3026',REPORT_DELIVERY_MODE:'simulate',PAYMENT_PROVIDER_MODE:'mock'},stdio:'inherit',windowsHide:true});
child.once('error',error=>{process.exitCode=1;reject(error);});
child.once('spawn',resolve);
});
if(!Number.isInteger(child.pid)||child.pid<=0)throw Error('RUNTIME_CHILD_PID_INVALID');
writeFileSync(receiptFd,JSON.stringify({pid:child.pid,parentPid:process.pid,worktree:process.cwd(),origin:'http://127.0.0.1:3026',head:source.head,tree:source.tree,buildId:source.buildId,sourceSha256:source.sourceAfter.sourceSha256,artifactSha256:source.artifactSha256,corpus,startedAt:new Date().toISOString(),syntheticLocalOnly:true},null,2)+'\n');
} catch(error) { startupError=error; throw error; }
finally {
try { closeSync(receiptFd); }
catch(error) { if(!startupError)throw error; startupError.receiptCloseFailed=true; }
}
} catch(error) { try { child?.kill(); } catch { error.childCleanupFailed=true; } throw error; }
child.once('exit',code=>{process.exitCode=code??1;});process.once('SIGINT',()=>child.kill());
