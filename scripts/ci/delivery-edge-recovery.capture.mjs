import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateAdmissionContext} from './delivery-admission.mjs';
import {collectEdgeArchive,sealEdgeArchive,openEdgeArchive} from './delivery-edge-recovery.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
export function validateArchiveContext(env){
 validateAdmissionContext(env);
 assert.equal(env.GITHUB_REF,'refs/heads/main');assert.equal(env.GITHUB_EVENT_NAME,'workflow_dispatch');
 assert.equal(env.EDGE_RECOVERY_ARCHIVE_SCOPE,'PRIMARY_READ_ONLY_5');
 assert.match(env.GITHUB_RUN_ATTEMPT??'',/^[1-9][0-9]*$/);
 return {controlCommit:env.GITHUB_SHA,runId:env.GITHUB_RUN_ID,runAttempt:Number(env.GITHUB_RUN_ATTEMPT)};
}
export function formatArchiveCapture({sealed,provenance,summary}){
 const bytes=Buffer.from(JSON.stringify(sealed));assert.ok(bytes.length<=160*1024*1024);
 const sha256=hash(bytes),encoded=bytes.toString('base64'),chunks=Math.ceil(encoded.length/12000);
 const events=[{event:'edge-recovery-capture',schema:'stallorder-edge-encrypted-capture/v1',...provenance,...summary,sha256,bytes:bytes.length,chunks,releaseAuthorized:false,restoreVerified:false}];
 for(let i=0;i<chunks;i++)events.push({event:'edge-recovery-chunk',sha256,index:i,data:encoded.slice(i*12000,(i+1)*12000)});
 events.push({event:'edge-recovery-complete',sha256,chunks});return events;
}
async function main(){
 const provenance=validateArchiveContext(process.env),token=process.env.SUPABASE_ACCESS_TOKEN;
 const archive=await collectEdgeArchive({token});
 const sealed=sealEdgeArchive(archive,token);
 // Authenticate the sealed bytes before publication. This is not a remote restore.
 assert.equal(hash(JSON.stringify(openEdgeArchive(sealed,token))),hash(JSON.stringify(archive)));
 const summary={project:archive.project,startedAt:archive.startedAt,finishedAt:archive.finishedAt,
  functions:archive.functions.map(f=>({slug:f.slug,id:f.metadata.id,version:f.metadata.version,sha256:f.wireSha256})),
  limitations:['No DB, Edge or application writes.','Remote restore remains unverified.','Keep this existing PAT unchanged until recovery is retired; rotation requires a fresh archive.']};
 for(const event of formatArchiveCapture({sealed,provenance,summary}))console.log(JSON.stringify(event));
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{await main();}catch(error){
  const message=typeof error?.message==='string'&&/^EDGE_ARCHIVE_[A-Z_0-9]+$/.test(error.message)?error.message:'EDGE_ARCHIVE_VALIDATION_FAILED';
  console.error(JSON.stringify({event:'edge-recovery-capture-failed',message,releaseAuthorized:false}));process.exitCode=1;
 }
}
