import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {EDGE_SLUGS} from './delivery-edge-recovery.mjs';
import {validatePairedSnapshot} from './delivery-edge-paired-snapshot.mjs';
import {buildPairedIntent} from './delivery-edge-intent.mjs';

const project = 'teunnvfakbfzmodajqjz';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const mutableProviderFields = new Set(['version', 'updated_at', 'sha256', 'ezbr_sha256', 'entrypoint_path', 'import_map_path', 'import_map']);
function validate(record, slug) {
  assert.equal(record.slug, slug); assert.equal(record.metadata.slug, slug);
  assert.equal(record.metadata.status, 'ACTIVE'); assert.equal(record.metadata.verify_jwt, false);
  assert.match(record.metadata.id ?? '', /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/);
  assert.ok(Number.isSafeInteger(record.metadata.version) && record.metadata.version > 0);
  assert.match(record.wireSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(typeof record.wireBase64, 'string'); assert.ok(record.wireBase64.length <= 16 * 1024 * 1024 * 4 / 3 + 4);
  const bytes = Buffer.from(record.wireBase64, 'base64');
  assert.equal(bytes.toString('base64'), record.wireBase64);
  assert.ok(bytes.length > 4 && bytes.length <= 16 * 1024 * 1024 && bytes.subarray(0, 4).equals(Buffer.from('EZBR')));
  assert.equal(hash(bytes), record.wireSha256); assert.equal(record.metadata.sha256, record.wireSha256);
  if (record.metadata.ezbr_sha256 !== undefined) assert.equal(record.metadata.ezbr_sha256, record.wireSha256);
  for (const key of ['entrypoint_path', 'import_map_path']) assert.ok(typeof record.metadata[key] === 'string' && record.metadata[key].length > 0 && record.metadata[key].length < 4096 && !/[\x00-\x1f\x7f]/.test(record.metadata[key]));
  if (record.metadata.import_map !== undefined) assert.equal(typeof record.metadata.import_map, 'boolean');
}
function compatible(actual, expectedBytes, targetIdentity) {
  validate(actual, expectedBytes.slug);
  assert.equal(actual.wireBase64, expectedBytes.wireBase64);
  assert.ok(actual.metadata.version >= targetIdentity.metadata.version);
  const keys = new Set([...Object.keys(actual.metadata), ...Object.keys(targetIdentity.metadata)]);
  for (const key of keys) if (!mutableProviderFields.has(key)) assert.deepEqual(actual.metadata[key], targetIdentity.metadata[key]);
  for (const key of ['entrypoint_path', 'import_map_path', 'import_map']) assert.deepEqual(actual.metadata[key], expectedBytes.metadata[key]);
}
// Read-only recovery preparation. The protected caller must authenticate the
// original snapshot and consumer. Even exact replay bytes do not authorize
// another PATCH: a durable journal must first rule out a pending earlier restore.
export async function inspectInterruptedPairedRecovery({snapshot,read}) {
  snapshot=structuredClone(snapshot);validatePairedSnapshot(snapshot);
  assert.equal(typeof read,'function');
  const candidates=[],restored=[],unresolved=[];
  for(const slug of EDGE_SLUGS) {
    const before=snapshot.functions.find(r=>r.slug===slug),target=snapshot.replayTargets.find(r=>r.slug===slug);
    try {
      const current=await read({project,slug});validate(current,slug);
      if(current.metadata.version===before.metadata.version+2) {
        compatible(current,before,before);restored.push(slug);continue;
      }
      assert.equal(current.metadata.version,before.metadata.version+1);
      assert.equal(current.wireSha256,target.wireSha256);
      for(const key of new Set([...Object.keys(current.metadata),...Object.keys(before.metadata)])) {
        if(!mutableProviderFields.has(key))assert.deepEqual(current.metadata[key],before.metadata[key]);
      }
      for(const key of ['entrypoint_path','import_map_path','import_map']) {
        assert.deepEqual(current.metadata[key]??null,target[key]);
      }
      candidates.push({slug,version:current.metadata.version,sha256:current.wireSha256});
    } catch {unresolved.push(slug);}
  }
  return {schema:'stallorder-paired-interruption-inspection/v1',project,controlCommit:snapshot.controlCommit,
    originalRunId:snapshot.runId,originalRunAttempt:snapshot.runAttempt,candidates,restored,unresolved,
    recoveryOnly:true,mutationAuthorized:false,cleanupVerified:false,productQualified:false,releaseAuthorized:false};
}
// Trusted protected workflow must supply source-authenticated archive, the one
// shared Preview writer lock, fixed-project adapter and actual usage verifier.
// Callbacks exist for offline failure injection; this module has no CLI.
export async function rehearseIsolatedEdgeRecovery({archive, preimages, read, apply, verifyUsage}) {
  const saved = new Map(), owned = new Map(), attempted = [], restored = [], replayed = [];
  let failed = false, cleanupFailed = false, usageVerified = false;
  try {
    archive = structuredClone(archive);
    assert.equal(archive.project, 'eyuctbnlvnbnivwasvqr');
    assert.equal(archive.schema, 'stallorder-delivery-edge-recovery/v1');
    assert.equal(archive.releaseAuthorized, false); assert.equal(archive.restoreVerified, false);
    assert.equal(archive.functions.length, 5);
    assert.equal(typeof verifyUsage, 'function');
    preimages = structuredClone(preimages);
    assert.ok(Array.isArray(preimages) && preimages.length === 5);
    for (const slug of EDGE_SLUGS) {
      const items = archive.functions.filter(f => f.slug === slug); assert.equal(items.length, 1); validate(items[0], slug);
      const prior = preimages.filter(f => f.slug === slug); assert.equal(prior.length, 1); validate(prior[0], slug);
    }
    // Save all five preimages before the first mutation. Each adapter read must
    // bind metadata/body/metadata; neither metadata alone nor HTTP 200 suffices.
    for (const slug of EDGE_SLUGS) {
      const record = await read({project, slug}); validate(record, slug);
      assert.ok(isDeepStrictEqual(record, preimages.find(f => f.slug === slug)), 'DURABLE_PREIMAGE_CHANGED');
      saved.set(slug, structuredClone(record));
    }
    for (const slug of EDGE_SLUGS) {
      const before = saved.get(slug), source = archive.functions.find(f => f.slug === slug);
      assert.ok(isDeepStrictEqual(await read({project, slug}), before), 'PREIMAGE_CHANGED');
      attempted.push(slug); // A timeout may have committed remotely: reconcile it.
      await apply({project, record: source});
      const after = await read({project, slug}); compatible(after, source, before);
      assert.equal(after.metadata.version, before.metadata.version + 1);
      owned.set(slug, structuredClone(after)); replayed.push(slug);
    }
    assert.equal(await verifyUsage(), true, 'USAGE_NOT_VERIFIED'); usageVerified = true;
  } catch {failed = true;}
  finally {
    for (const slug of attempted.toReversed()) {
      const before = saved.get(slug), source = archive.functions.find(f => f.slug === slug);
      try {
        const current = await read({project, slug});
        // An attempted PATCH may arrive after a timeout. Seeing the unchanged
        // preimage is not evidence that the provider has settled that request.
        compatible(current, source, before);
        assert.equal(current.metadata.version, before.metadata.version + 1, 'AMBIGUOUS_VERSION');
        if (owned.has(slug)) assert.ok(isDeepStrictEqual(current, owned.get(slug)), 'POSTIMAGE_CHANGED');
        await apply({project, record: before});
        const after = await read({project, slug}); compatible(after, before, before);
        assert.equal(after.metadata.version, before.metadata.version + 2, 'RESTORE_VERSION_CHANGED');
        restored.push(slug);
      } catch {cleanupFailed = true;}
    }
  }
  const receipt = {schema: 'stallorder-isolated-edge-rehearsal/v1', project,
    replayed, restored, usageVerified, cleanupVerified: !cleanupFailed && restored.length === attempted.length,
    releaseAuthorized: false, productionRecoveryVerified: false};
  if (failed || cleanupFailed) {
    const error = new Error(cleanupFailed ? 'EDGE_REHEARSAL_CLEANUP_REQUIRED' : 'EDGE_REHEARSAL_FAILED');
    error.receipt = receipt; throw error;
  }
  return receipt;
}

// Internal fixed-phase engine only. The protected entry must authenticate the
// completed intent, original snapshot, one-use admission and actual executor.
// This module has no CLI. Recovery is a separate intent/job; never a finally PATCH.
export async function executeDurableEdgePhase({snapshot,snapshotSha256,archive,phase,intent,read,apply,emit}) {
 const attempted=[],verified=[];let plan;
 try {
  snapshot=structuredClone(snapshot);archive=structuredClone(archive);
  plan=buildPairedIntent({snapshot,snapshotSha256,phase});assert.deepEqual(intent,plan);
  for(const fn of [read,apply,emit])assert.equal(typeof fn,'function');
  assert.equal(archive.schema,'stallorder-delivery-edge-recovery/v1');
  assert.equal(archive.project,'eyuctbnlvnbnivwasvqr');
  assert.equal(archive.restoreVerified,false);assert.equal(archive.releaseAuthorized,false);
  assert.equal(archive.functions.length,5);
  for(const slug of EDGE_SLUGS) {
   const found=archive.functions.filter(r=>r.slug===slug);assert.equal(found.length,1);validate(found[0],slug);
   const r=found[0],target=snapshot.replayTargets.find(r=>r.slug===slug);
   assert.equal(r.wireSha256,target.wireSha256);
   for(const key of ['entrypoint_path','import_map_path','import_map'])assert.deepEqual(r.metadata[key]??null,target[key]);
  }
  const beforeFor=slug=>snapshot.functions.find(r=>r.slug===slug);
  const archiveFor=slug=>archive.functions.find(r=>r.slug===slug);
  const assertPreimage=(current,slug)=>{
   const before=beforeFor(slug),expected=phase==='replay'?before:archiveFor(slug);
   compatible(current,expected,before);
   assert.equal(current.metadata.version,before.metadata.version+(phase==='restore'?1:0));
   if(phase==='replay')assert.ok(isDeepStrictEqual(current,before),'DURABLE_PREIMAGE_CHANGED');
  };
  // An invalid later function blocks the entire phase before the first write.
  for(const slug of EDGE_SLUGS)assertPreimage(await read({project,slug}),slug);
  for(const operation of plan.operations) {
   const slug=operation.slug,before=beforeFor(slug),target=phase==='replay'?archiveFor(slug):before;
   assertPreimage(await read({project,slug}),slug);
   await emit({event:'paired-edge-operation-started',operationId:operation.operationId,phase,slug,
    expectedVersion:operation.expectedVersion,resultVersion:operation.resultVersion});
   assertPreimage(await read({project,slug}),slug);
   attempted.push(slug);
   await apply({project,record:structuredClone(target)});
   const after=await read({project,slug});compatible(after,target,before);
   assert.equal(after.metadata.version,operation.resultVersion);
   verified.push(slug);
   await emit({event:'paired-edge-operation-verified',operationId:operation.operationId,phase,slug,
    version:after.metadata.version,wireSha256:after.wireSha256});
  }
 } catch {
  const error=new Error('EDGE_DURABLE_PHASE_INCOMPLETE');
  error.receipt={schema:'stallorder-paired-edge-phase/v1',phase:['replay','restore'].includes(phase)?phase:null,attempted,verified,complete:false,
   cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false};
  throw error;
 }
 return {schema:'stallorder-paired-edge-phase/v1',project,controlCommit:snapshot.controlCommit,
  runId:snapshot.runId,runAttempt:snapshot.runAttempt,phase,planSha256:hash(JSON.stringify(plan)),
  attempted,verified,complete:true,cleanupVerified:false,productionRecoveryVerified:false,releaseAuthorized:false};
}
