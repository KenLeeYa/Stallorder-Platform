import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import assert from 'node:assert/strict';
import {verifyLiveFixture} from './live-fixture-guard.mjs';
import {projectLegacyApplications} from './report-schema-overlay.mjs';
export async function preserveOriginals(db){
 const corpus=(await verifyLiveFixture(db)).receipt;
 const path='.superpowers/sdd/2026-10-01-awesome-optimization/batch-2/repair-1/approval-postimages.json',bytes=readFileSync(path),original=JSON.parse(bytes),checks=[];
 for(const entry of original.cases){
  const expected=entry.data,app=await db.merchantApplication.findUniqueOrThrow({where:{id:expected.application.id}});
  assert.equal(app.draftVersion,0);const actual={application:projectLegacyApplications([app])[0]};
  for(const [key,model]of Object.entries({organization:'organization',subscriptions:'subscription',stalls:'stall',qrs:'qrCode',memberships:'organizationMembership',notifications:'merchantApplicationNotification'})){
   const reference=expected[key],array=Array.isArray(reference),rows=array?reference:[reference];
   const read=await db[model].findMany({where:{id:{in:rows.map(r=>r.id)}},select:Object.fromEntries(Object.keys(rows[0]).map(k=>[k,true]))});
   actual[key]=array?rows.map(r=>read.find(a=>a.id===r.id)):read[0];
  }
  assert.equal(JSON.stringify(actual),JSON.stringify(expected));checks.push({applicationId:app.id,originalDraftVersionExpected:0,digest:createHash('sha256').update(JSON.stringify(expected)).digest('hex'),unchanged:true});
 }
 return{corpus,originalReceipt:path,originalReceiptSha256:createHash('sha256').update(bytes).digest('hex'),checks};
}
