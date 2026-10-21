import { expect, test } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, renameSync, rmSync, symlinkSync } from 'node:fs';
import { lstat, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { runInNewContext } from 'node:vm';
import { readCheckedFile } from './lib/checked-file-read.mjs';

const source = readFileSync(new URL('./production-approval.mjs', import.meta.url), 'utf8');
for (const [name, next, invalid] of [['verifyReceipt', 'workflowContext', 'PLAN_RECEIPT_FILE_INVALID'], ['verifyEvidence', 'createReceipt', 'OPERATION_EVIDENCE_FILE_INVALID']]) {
 const fragment = source.slice(source.indexOf(`async function ${name}()`), source.indexOf(`\n${next === 'workflowContext' ? 'function' : 'async function'} ${next}()`));
 async function exercise(kind) {
  const directory = mkdtempSync(join(tmpdir(), 'approval-read-')), file = join(directory, 'receipt.json');
  writeFileSync(file, JSON.stringify({ marker: 'original' }));
  if (kind === 'oversize') writeFileSync(file, 'x'.repeat(65 * 1024));
  if (kind === 'malformed') writeFileSync(file, '{');
  if (kind === 'directory') { rmSync(file); }
  if (kind === 'symlink') { rmSync(file); symlinkSync(directory, file, process.platform === 'win32' ? 'junction' : 'dir'); }
  const selected = kind === 'directory' ? directory : file;
  let validated;
  const context = { repository: 'owner/repo', runId: '22', actor: 'owner', repositoryOwner: 'owner', commitSha: 'a'.repeat(40) };
  const validate = input => { if (kind === 'validator') throw Error('VALIDATION_SENTINEL'); validated = input; return { operation: 'test', runId: '11', planRunId: '11' }; };
  try {
   await runInNewContext(`(${fragment})()`, {
    resolve, required: key => key.endsWith('_PATH') ? selected : key.endsWith('_RUN_ID') ? '11' : 'test',
    workflowContext: () => context, requireOwnerActor() {}, git: () => 'tree', gitTrees: () => ({ treeSha: 'tree', stagingTreeSha: 'tree' }),
    parameters: () => ({}), githubRun: async () => ({}), console: { log() {} },
    validateProductionApprovalReceipt: validate, validateProductionOperationEvidence: validate,
    lstat: async path => {
     const stats = await lstat(path);
     if (kind === 'replacement') { renameSync(file, join(directory, 'original.json')); writeFileSync(file, JSON.stringify({ marker: 'replaced-after-path-check' })); }
     return stats;
    }, readFile, readCheckedFile: kind === 'open-error' ? () => { throw Object.assign(Error('denied'), { code: 'EACCES' }); } : readCheckedFile,
   });
   return validated;
  } finally { rmSync(directory, { recursive: true, force: true }); }
 }
 test(`${name}: rejects replacement between path metadata and byte read`, async () => {
  await expect(exercise('replacement')).rejects.toThrow(invalid);
 });
 test(`${name}: validates unchanged regular JSON with existing validator`, async () => {
  const result = await exercise('regular');
  expect(result.receipt ?? result.evidence).toEqual({ marker: 'original' });
 });
 for (const kind of ['oversize', 'directory', 'symlink', 'open-error']) test(`${name}: preserves file-invalid rejection for ${kind}`, async () => {
  await expect(exercise(kind)).rejects.toThrow(invalid);
 });
 test(`${name}: malformed JSON retains its parser failure`, async () => {
  await expect(exercise('malformed')).rejects.toMatchObject({ name: 'SyntaxError' });
 });
 test(`${name}: retains the existing validator failure`, async () => {
  await expect(exercise('validator')).rejects.toThrow('VALIDATION_SENTINEL');
 });
}
