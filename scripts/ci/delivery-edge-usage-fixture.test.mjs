import test from 'node:test';
import assert from 'node:assert/strict';
import {createUsageFixture, validateUsageFixturePair} from './delivery-edge-usage-fixture.mjs';

test('two usage passes have separately owned, source-bindable synthetic identifiers',()=>{
  const pair=[createUsageFixture('123'),createUsageFixture('123')];
  assert.doesNotThrow(()=>validateUsageFixturePair(pair,'123'));
  assert.notEqual(pair[0].organizationId,pair[1].organizationId);
  assert.notEqual(pair[0].qrToken,pair[1].qrToken);
});
for(const [name,mutate] of [
  ['missing pass',p=>p.pop()],['shared identity',p=>{p[1].orderId=p[0].orderId;}],
  ['wrong run',p=>{p[1].runId='124';}],['foreign prefix',p=>{p[0].prefix='production';}],
  ['changed QR',p=>{p[0].qrToken='other';}],['duplicate hours',p=>{p[0].hourIds[1]=p[0].hourIds[0];}],
  ['extra fields',p=>{p[0].credential='synthetic-unexpected';}],
])test('rejects unsafe durable fixture: '+name,()=>{
  const pair=[createUsageFixture('123'),createUsageFixture('123')];mutate(pair);
  assert.throws(()=>validateUsageFixturePair(pair,'123'));
});
