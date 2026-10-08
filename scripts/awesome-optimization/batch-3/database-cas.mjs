import { loadEnvFile } from 'node:process';
import { randomUUID, createHash } from 'node:crypto';
import { writeFileSync, existsSync, openSync, closeSync } from 'node:fs';
import assert from 'node:assert/strict';
import { openGuardedDatabase, verifyLiveFixture } from '../../../docs/awesome-optimization/qa/live-fixture-guard.mjs';
loadEnvFile('.env.local');
const directory='.superpowers/sdd/2026-10-01-awesome-optimization/batch-3';
const mode=process.argv[2]??'stale';
const receiptPath=`${directory}/database-${mode}-${process.argv[3]??'red'}.json`;
if(existsSync(receiptPath))throw Error('BATCH3_RECEIPT_EXISTS');
const db=await openGuardedDatabase();
const proof={mode,startedAt:new Date().toISOString(),status:'RUNNING',checks:[],syntheticLocalOnly:true};
let receiptFd,primaryError;
try {
 proof.corpus=(await verifyLiveFixture(db)).receipt;
 receiptFd=openSync(receiptPath,'wx');
 const {saveMerchantApplicationDraft,submitMerchantApplication,getApplicantApplication}=await import('../../../src/server/merchant-applications/merchant-application-service.ts');
 const {prisma}=await import('../../../src/lib/prisma.ts');
 const profileId=randomUUID(),email=`awesome-b3-${mode}-${profileId}@stallorder.test`;
 proof.fixture={profileId,email,preimage:'ABSENT',retained:true};
 assert.equal(await db.profile.count({where:{id:profileId}}),0);
 await db.profile.create({data:{id:profileId,email,displayName:'Awesome Batch3 合成申請人',authIdentities:{create:{provider:'GOOGLE',providerSubject:`awesome-b3/${profileId}`,providerEmail:email,providerEmailVerified:true}}}});
 const identity={profileId,authUserId:null,email,displayName:'Awesome Batch3 合成申請人',sessionId:`awesome-b3/${profileId}`};
 const input={identity,applicationId:null,expectedDraftVersion:0,currentStep:1,data:{phone:'0912345678',preferredContactMethod:'PHONE'},audit:{requestId:randomUUID(),ipHash:createHash('sha256').update(profileId).digest('hex')}};
 if(mode==='stale'){
  const first=await saveMerchantApplicationDraft(input);
  proof.fixture.applicationId=first.id;
  const newer=await saveMerchantApplicationDraft({...input,applicationId:first.id,expectedDraftVersion:first.draftVersion,data:{phone:'0911111111'}});
  await assert.rejects(saveMerchantApplicationDraft({...input,applicationId:first.id,expectedDraftVersion:first.draftVersion,data:{phone:'0922222222'}}),e=>e.code==='DRAFT_VERSION_CONFLICT');
  const read=await getApplicantApplication(profileId);assert.equal(read.phone,'0911111111');assert.equal(read.draftVersion,2);assert.equal(newer.draftVersion,2);
  proof.checks.push({case:'stale editor denied; accepted newer text survives authorized read',id:read.id,version:read.draftVersion});
 } else if(mode==='concurrent-create') {
  const result=await Promise.allSettled([saveMerchantApplicationDraft(input),saveMerchantApplicationDraft({...input,data:{phone:'0933333333'}})]);
  proof.outcomes=result.map(v=>v.status==='fulfilled'?{status:v.status,id:v.value.id,version:v.value.draftVersion}:{status:v.status,code:v.reason.code,meta:v.reason.meta});
  assert.equal(result.filter(v=>v.status==='fulfilled').length,1);const denial=result.find(v=>v.status==='rejected');assert.equal(denial?.reason.code,'DRAFT_VERSION_CONFLICT');
  const read=await getApplicantApplication(profileId);proof.fixture.applicationId=read.id;assert.equal(read.draftVersion,1);assert.equal(await db.merchantApplication.count({where:{applicantProfileId:profileId,status:'DRAFT'}}),1);
  proof.checks.push({case:'concurrent create has one accepted draft and one visible conflict',id:read.id,version:1});
 } else if(mode==='transitions') {
  const {applyMerchantApplicationReviewAction}=await import('../../../src/server/merchant-applications/merchant-application-admin-service.ts');
  const context={actorProfileId:'55555555-5555-4555-8555-555555555554',...input.audit};
  const data={phone:'0912345678',lineId:null,preferredContactMethod:'PHONE',merchantName:'Awesome Batch3 補件合成商家',businessType:'NIGHT_MARKET_STALL',businessRegistrationNumber:null,contactName:'合成聯絡人',businessPhone:'0912345678',businessAddress:'臺北市合成地址一號',city:'臺北市',merchantDescription:null,stallName:'Awesome Batch3 合成攤位',stallLocation:'本機合成測試區',requestedSlug:`awesome-b3-${profileId.slice(0,8)}`,estimatedDailyOrders:null,expectedStartDate:null,needsMultipleStaff:false,needsKitchenView:false,requestedPlanCode:'TRIAL',termsAccepted:true,privacyAccepted:true,dataProcessingAccepted:true,informationConfirmed:true};
  const first=await saveMerchantApplicationDraft(input);proof.fixture.applicationId=first.id;assert.equal(first.draftVersion,1);
  const submitted=await submitMerchantApplication({identity,applicationId:first.id,expectedDraftVersion:1,data,audit:input.audit});assert.equal(submitted.draftVersion,3);assert.equal(submitted.status,'PENDING_REVIEW');
  await assert.rejects(submitMerchantApplication({identity,applicationId:first.id,expectedDraftVersion:1,data,audit:input.audit}),e=>e.code==='DRAFT_VERSION_CONFLICT');
  const review=await applyMerchantApplicationReviewAction(first.id,{action:'REQUEST_INFO',publicReviewNote:'請補充合成營業地址資料'},context);assert.equal(review.draftVersion,4);
  await assert.rejects(saveMerchantApplicationDraft({...input,applicationId:first.id,expectedDraftVersion:3}),e=>e.code==='DRAFT_VERSION_CONFLICT');
  const edited=await saveMerchantApplicationDraft({...input,applicationId:first.id,expectedDraftVersion:4,data:{businessAddress:'臺北市已補件合成地址二號'}});assert.equal(edited.draftVersion,5);
  const resubmitted=await submitMerchantApplication({identity,applicationId:first.id,expectedDraftVersion:5,data:{...data,businessAddress:'臺北市已補件合成地址二號'},audit:input.audit});assert.equal(resubmitted.id,first.id);assert.equal(resubmitted.draftVersion,7);
  const rejected=await applyMerchantApplicationReviewAction(first.id,{action:'REJECT',publicReviewNote:'合成重新申請驗證',reapplicationAllowed:true},context);assert.equal(rejected.draftVersion,8);
  const terminal=JSON.stringify(await db.merchantApplication.findUnique({where:{id:first.id}}));
  const reapplication=await saveMerchantApplicationDraft(input);assert.notEqual(reapplication.id,first.id);assert.equal(reapplication.draftVersion,1);assert.equal(JSON.stringify(await db.merchantApplication.findUnique({where:{id:first.id}})),terminal);
  await submitMerchantApplication({identity,applicationId:reapplication.id,expectedDraftVersion:1,data,audit:input.audit});
  const withdrawn=await applyMerchantApplicationReviewAction(reapplication.id,{action:'WITHDRAW'},context);assert.equal(withdrawn.draftVersion,4);
  const afterWithdraw=await saveMerchantApplicationDraft(input);assert.notEqual(afterWithdraw.id,reapplication.id);assert.equal(afterWithdraw.draftVersion,1);
  proof.checks.push({case:'NEEDS_INFO sameid/version resubmit and rejected/withdrawn additive reapplication',id:first.id,versions:[1,3,4,5,7,8],reapplicationId:reapplication.id,afterWithdrawId:afterWithdraw.id,terminalPreimagePreserved:true});
 }
 await prisma.$disconnect();proof.status='PASS';
}catch(error){primaryError=error;proof.status='FAILED';proof.failure=error.stack;process.exitCode=1;}
finally{
 proof.finishedAt=new Date().toISOString();
 try { await db.$disconnect(); }
 catch(error){if(!primaryError)primaryError=error;proof.status='FAILED';proof.failure??=error.stack;}
 if(receiptFd!==undefined){
  try { writeFileSync(receiptFd,JSON.stringify(proof,null,2)+'\n'); }
  catch(error){proof.status='FAILED';if(!primaryError)primaryError=error;else primaryError.receiptWriteFailed=true;}
  finally { try { closeSync(receiptFd); } catch(error){if(!primaryError)primaryError=error;else primaryError.receiptCloseFailed=true;} }
 }
 console.log(JSON.stringify({status:proof.status,checks:proof.checks.length,failure:proof.failure?.split('\n')[0],receiptPath}));
}
if(primaryError)throw primaryError;
