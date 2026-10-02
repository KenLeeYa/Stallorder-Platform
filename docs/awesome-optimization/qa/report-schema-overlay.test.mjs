import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { assertApplicationOverlaySchema, projectLegacyApplications } from './report-schema-overlay.mjs';
test('report overlay admits only the explicit reviewed schema bytes',()=>{
 assertApplicationOverlaySchema();
 assert.throws(()=>assertApplicationOverlaySchema(Buffer.from('unknown schema')),/SCHEMA_UNEXPECTED/);
 assert.throws(()=>assertApplicationOverlaySchema(Buffer.concat([readFileSync('prisma/schema.prisma'),Buffer.from('\n')])),/SCHEMA_UNEXPECTED/);
});
test('original application projection preserves all old bytes and rejects extra field/default drift',()=>{
 const fixture=JSON.parse(readFileSync('.superpowers/sdd/2026-10-01-awesome-optimization/batch-2/repair-1/approval-postimages.json'));
 for(const item of fixture.cases){
  const legacy=item.data.application,current={};
  for(const [key,value]of Object.entries(legacy)){current[key]=value;if(key==='currentStep')current.draftVersion=0;}
  assert.deepEqual(projectLegacyApplications([current]),[legacy]);
  assert.throws(()=>projectLegacyApplications([{...current,draftVersion:1}]),/DEFAULT_DRIFT/);
  assert.throws(()=>projectLegacyApplications([{...current,unapprovedField:true}]),/SCHEMA_UNEXPECTED/);
  const changed={...current,merchantName:'changed old fact'};
  assert.notDeepEqual(projectLegacyApplications([changed]),[legacy]);
 }
});
