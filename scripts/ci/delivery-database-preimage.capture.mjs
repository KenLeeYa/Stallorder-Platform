import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {readFileSync,readdirSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {validateDatabaseCaptureContext,validatePrimaryEndpoint,managementGet} from './delivery-database-executor.capture.mjs';
import {collectNativePreimage,nativePreimageCollectionFailure} from './delivery-database-preimage.collect.mjs';
import {sealNativePreimage,openNativePreimage,formatNativePreimageCapture} from './delivery-database-preimage.archive.mjs';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..'),primary='eyuctbnlvnbnivwasvqr';
const hash=b=>createHash('sha256').update(b).digest('hex');
const contractPath='scripts/ci/delivery-executor-contract.json';
export const NATIVE_PREIMAGE_SOURCE_PATHS=Object.freeze([
 '.github/workflows/production-delivery-evidence.yml',contractPath,
 'scripts/ci/delivery-database-executor.capture.mjs','scripts/ci/delivery-native-read-connection.mjs',
 'scripts/ci/delivery-database-preimage.capture.mjs','scripts/ci/delivery-database-preimage.collect.mjs',
 'scripts/ci/delivery-database-preimage.archive.mjs','scripts/ci/delivery-database-preimage.mjs',
 'scripts/ci/delivery-database-recovery.mjs',
]);
const digests=()=>Object.fromEntries(NATIVE_PREIMAGE_SOURCE_PATHS.map(p=>[p,hash(readFileSync(resolve(root,p)))]));
class NativeCaptureError extends Error {}
export const nativePreimageCaptureFailure=e=>e instanceof NativeCaptureError?e.message:'DELIVERY_NATIVE_CAPTURE_FAILED';
export async function captureNativePreimage({env,token,password,versions,fetchImpl=fetch,collect=collectNativePreimage,clock=()=>new Date().toISOString()}) {
 let stage='CONTEXT';
 try {
  const provenance=validateDatabaseCaptureContext(env),requestStartedAt=clock();
  stage='SOURCE';const sourceDigests=digests(),plan=JSON.parse(readFileSync(resolve(root,contractPath)));
  assert.equal(plan.database.projectId,primary);assert.ok(Array.isArray(versions)&&versions.length===146);
  stage='CREDENTIAL_INPUT';assert.match(token??'',/^sbp_[a-f0-9]{40}$/);
  assert.ok(typeof password==='string'&&password.length>0&&password.length<=4096&&!/[\x00-\x1f\x7f]/.test(password));
  const endpointRead=async()=>{
   const [project,poolers]=await Promise.all([managementGet('/v1/projects/'+primary,token,fetchImpl),managementGet('/v1/projects/'+primary+'/config/database/pooler',token,fetchImpl)]);
   return validatePrimaryEndpoint(project,poolers);
  };
  stage='PROVIDER_READ';const endpoint=await endpointRead();
  const u=new URL('postgresql://placeholder.invalid');u.hostname=endpoint.hostname;u.port=endpoint.port;
  u.username=endpoint.username;u.password=encodeURIComponent(password);u.pathname='/postgres';
  u.searchParams.set('sslmode','require');u.searchParams.set('connect_timeout','10');
  stage='COLLECTOR';let collected;
  try{collected=collect({connection:u.href,endpoint,plan,versions,clock});}
  catch(error){throw new NativeCaptureError('DELIVERY_NATIVE_CAPTURE_COLLECTOR_'+nativePreimageCollectionFailure(error));}
  stage='READBACK';const readback=await endpointRead();assert.ok(isDeepStrictEqual(endpoint,readback));
  stage='SOURCE_READBACK';assert.ok(isDeepStrictEqual(sourceDigests,digests()));
  const archive={schema:'stallorder-delivery-native-preimage-archive/v1',projectId:primary,...provenance,
   productCommit:plan.productCommit,productTree:plan.productTree,requestStartedAt,finishedAt:clock(),
   endpoint,sourceDigests,raw:collected.raw,preimageSha256:collected.preimageSha256,
   interval:{startedAt:collected.requestStartedAt,finishedAt:collected.requestFinishedAt},releaseAuthorized:false};
  stage='ENCRYPT';const sealed=sealNativePreimage(archive,token);
  assert.ok(isDeepStrictEqual(openNativePreimage(sealed,token),archive));
  return formatNativePreimageCapture(sealed,archive);
 }catch(error){throw error instanceof NativeCaptureError?error:new NativeCaptureError('DELIVERY_NATIVE_CAPTURE_'+stage);}
}
function frozenVersions() {
 const product=resolve(root,'../product');
 const git=args=>execFileSync('git',args,{cwd:product,encoding:'utf8',timeout:10000,maxBuffer:1024*1024,stdio:['ignore','pipe','pipe']}).trim();
 assert.equal(git(['rev-parse','HEAD']),'0d2b27144fcf589bb887e669c09e82158e3de7a2');
 assert.equal(git(['rev-parse','HEAD^{tree}']),'e3c02e6b0ecf37526a77ff9c6eb4eb2111411ef0');
 assert.equal(git(['status','--porcelain']),'');
 const files=readdirSync(resolve(product,'supabase/migrations')).filter(n=>n.endsWith('.sql')).sort();
 assert.equal(files.length,147);assert.equal(files.at(-1),'20261029090000_public_delivery_ordering_hours.sql');
 return files.slice(0,146).map(n=>{assert.match(n,/^[0-9]{14}_[a-z0-9_]+\.sql$/);return n.slice(0,14);});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {
  assert.equal(process.env.DELIVERY_EXECUTOR_CONTRACT_SHA256,hash(readFileSync(resolve(root,contractPath))));
  const events=await captureNativePreimage({env:process.env,token:process.env.SUPABASE_ACCESS_TOKEN,password:process.env.SUPABASE_DB_PASSWORD,versions:frozenVersions()});
  for(const event of events)console.log(JSON.stringify(event));
 }catch(error){console.error(JSON.stringify({event:'delivery-native-preimage-failed',reason:nativePreimageCaptureFailure(error),releaseAuthorized:false}));process.exitCode=1;}
}
