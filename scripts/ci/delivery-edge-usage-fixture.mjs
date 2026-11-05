import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';

const schema='stallorder-isolated-edge-usage-fixture/v1';
const idFields=['organizationId','stallId','subscriptionId','categoryId','productId','stallProductId',
  'qrId','orderId','deviceId','sessionRequestId','idempotencyKey','turnstileIdempotencyKey'];
const uuid=/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/;
export function createUsageFixture(runId) {
  assert.match(runId??'',/^[1-9][0-9]*$/);
  const prefix=`edge-restore-${runId}-${randomUUID()}`;
  return {schema,runId,...Object.fromEntries(idFields.map(key=>[key,randomUUID()])),
    prefix,qrToken:prefix+'-synthetic',hourIds:Array.from({length:7},()=>randomUUID())};
}
export function validateUsageFixture(fixture,runId) {
  assert.match(runId??'',/^[1-9][0-9]*$/);
  assert.ok(fixture && Object.getPrototypeOf(fixture)===Object.prototype);
  assert.deepEqual(Object.keys(fixture).sort(),['schema','runId',...idFields,'prefix','qrToken','hourIds'].sort());
  assert.equal(fixture.schema,schema);assert.equal(fixture.runId,runId);
  for(const field of idFields)assert.match(fixture[field]??'',uuid);
  assert.ok(Array.isArray(fixture.hourIds)&&fixture.hourIds.length===7);
  for(const id of fixture.hourIds)assert.match(id,uuid);
  const ids=[...idFields.map(key=>fixture[key]),...fixture.hourIds];
  assert.equal(new Set(ids).size,ids.length);
  const prefix=`edge-restore-${runId}-`;
  assert.ok(typeof fixture.prefix==='string'&&fixture.prefix.startsWith(prefix));
  assert.match(fixture.prefix.slice(prefix.length),uuid);
  assert.equal(fixture.qrToken,fixture.prefix+'-synthetic');
  return ids;
}
export function validateUsageFixturePair(pair,runId) {
  assert.ok(Array.isArray(pair)&&pair.length===2);
  const ids=pair.flatMap(fixture=>validateUsageFixture(fixture,runId));
  assert.equal(new Set(ids).size,ids.length);
  assert.notEqual(pair[0].prefix,pair[1].prefix);
}
