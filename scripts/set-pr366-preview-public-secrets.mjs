import { execFile } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import { assertTarget } from './qa-pr366-preview-ui.mjs';
import { readCheckedFile } from './lib/checked-file-read.mjs';

const execute = promisify(execFile);

function metadataWriteFailure(error) {
  if (error?.killed || error?.code !== 1 || typeof error.stderr !== 'string') return false;
  const plain = error.stderr.replace(/\u001b\[[0-9;]*m/g, '');
  const match = plain.match(/^Unexpected error setting project secrets:\s*(\{[^\r\n]*\})\s*$/m);
  try { return Boolean(match && JSON.parse(match[1]).message === 'Failed to write functions metadata fields'); }
  catch { return false; }
}

// Only these two idempotent child configuration values may be retried.
export async function setPreviewPublicSecrets({ receipt, binding, childRef, save,
  run = execute, now = Date.now, wait = sleep }) {
  const origin = assertTarget(receipt, binding, now());
  if (childRef !== binding.childRef || !/^[a-z]{20}$/.test(childRef)) throw Error('PREVIEW_SECRET_CHILD_DENIED');
  const args = ['secrets', 'set', '--project-ref', childRef,
    `PUBLIC_APP_ORIGINS=${origin}`, 'TRUSTED_CLIENT_IP_HEADER=x-real-ip'];
  const evidence = { resourceKey: receipt.resourceKey, childRef, deploymentId: binding.deploymentId,
    sha: binding.sha, attempts: [], status: 'RUNNING' };
  const deadline = Math.min(now() + 100_000, Date.parse(receipt.expiresAt) - 10 * 60_000);
  for (let attempt = 1; attempt <= 3; attempt++) {
    assertTarget(receipt, binding, now());
    if (deadline - now() < 30_000) {
      evidence.status = 'FAIL'; evidence.code = 'PREVIEW_SECRET_DEADLINE'; save(evidence);
      throw Error(evidence.code);
    }
    evidence.attempts.push({ attempt, status: 'RUNNING' }); save(evidence);
    try {
      await run('supabase', args, { timeout: 30_000, killSignal: 'SIGKILL', maxBuffer: 64 * 1024 });
      evidence.attempts.at(-1).status = 'PASS'; evidence.status = 'PASS'; save(evidence);
      return evidence;
    } catch (error) {
      const retryable = metadataWriteFailure(error);
      Object.assign(evidence.attempts.at(-1), { status: 'FAIL', code: retryable ? 'PROVIDER_METADATA_WRITE_FAILED' : 'PROVIDER_COMMAND_FAILED' });
      if (!retryable || attempt === 3) {
        evidence.status = 'FAIL'; evidence.code = 'PREVIEW_SECRET_SET_FAILED'; save(evidence);
        throw Error(evidence.code);
      }
      save(evidence);
      await wait(attempt === 1 ? 2_000 : 5_000);
    }
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const load = path => JSON.parse(readCheckedFile(path, { maxBytes: 256 * 1024 }).toString('utf8'));
    await setPreviewPublicSecrets({ receipt: load(process.argv[2]), binding: load(process.argv[3]),
      childRef: process.env.PR366_CHILD_REF,
      save: evidence => writeFileSync(process.argv[4], JSON.stringify(evidence, null, 2)) });
  } catch { console.error('PREVIEW_SECRET_CONFIGURATION_FAILED'); process.exitCode = 1; }
}
