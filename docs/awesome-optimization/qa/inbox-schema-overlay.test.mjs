import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {assertApplicationOverlaySchema,projectLegacyApplications} from './inbox-schema-overlay.mjs';
const original=JSON.parse(readFileSync('.superpowers/sdd/2026-10-01-awesome-optimization/batch-2/repair-1/approval-postimages.json')).cases[0].data.application;
const current=Object.fromEntries(Object.entries(original).flatMap(([key,value])=>key==='currentStep'?[[key,value],['draftVersion',0]]:[[key,value]]));
test('only exact separately named Inbox schema is accepted',()=>{
  assert.doesNotThrow(()=>assertApplicationOverlaySchema());
  assert.throws(()=>assertApplicationOverlaySchema(Buffer.from('unknown schema')),/SCHEMA_UNEXPECTED/);
  const bytes=readFileSync('prisma/schema.prisma','utf8');
  assert.throws(()=>assertApplicationOverlaySchema(Buffer.from(bytes.replace('analyticsConsent Boolean @default(false)','analyticsConsent Boolean @default(true)'))),/SCHEMA_UNEXPECTED/);
});
test('the original draftVersion projection still rejects unknown fields and changed defaults',()=>{
  assert.deepEqual(projectLegacyApplications([current]),[original]);
  assert.throws(()=>projectLegacyApplications([{...current,draftVersion:1}]),/DEFAULT_DRIFT/);
  assert.throws(()=>projectLegacyApplications([{...current,unknown:true}]),/SCHEMA_UNEXPECTED/);
});
