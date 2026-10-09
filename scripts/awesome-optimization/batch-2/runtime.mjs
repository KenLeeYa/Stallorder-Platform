import { spawn } from 'node:child_process';
import { loadEnvFile } from 'node:process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { assertResponsiveQaTarget } from '../../responsive-qa-target.mjs';
import { readResponsiveBuildProvenance } from '../../responsive-build-provenance.mjs';
loadEnvFile('.env.local');
assertResponsiveQaTarget(process.env);
for (const name of ['DR_DATABASE_URL','DR_DIRECT_URL']) {
 if (process.env[name]) { const value=new URL(process.env[name]); if(!['127.0.0.1','localhost'].includes(value.hostname)||value.port!=='56822'||value.pathname!=='/postgres') throw Error('AWESOME_ADDITIONAL_DATABASE_TARGET_DENIED'); }
}
const manifest=JSON.parse(readFileSync('.next/responsive-build-provenance.json','utf8'));
const source=readResponsiveBuildProvenance({expectedSourceSha256:manifest.sourceAfter?.sourceSha256});
await new Promise((resolve,reject)=>{const probe=createServer();probe.once('error',()=>reject(Error('AWESOME_APP_PORT_IN_USE')));probe.listen(3026,'127.0.0.1',()=>probe.close(resolve));});
const child=spawn(process.execPath,['node_modules/next/dist/bin/next','start','-H','127.0.0.1','-p','3026'],{env:{...process.env,APP_BASE_URL:'http://127.0.0.1:3026',NEXT_PUBLIC_APP_URL:'http://127.0.0.1:3026',REPORT_DELIVERY_MODE:'simulate',PAYMENT_PROVIDER_MODE:'mock'},stdio:'inherit',windowsHide:true});
writeFileSync('.superpowers/sdd/2026-10-01-awesome-optimization/batch-2/runtime.json',JSON.stringify({pid:child.pid,parentPid:process.pid,worktree:process.cwd(),origin:'http://127.0.0.1:3026',head:source.head,tree:source.tree,buildId:source.buildId,sourceSha256:source.sourceAfter.sourceSha256,artifactSha256:source.artifactSha256,startedAt:new Date().toISOString()},null,2)+'\n');
child.once('exit',code=>{process.exitCode=code??1;});
process.once('SIGINT',()=>child.kill());
