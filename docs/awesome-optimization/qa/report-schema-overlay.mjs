import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const applicationOverlayVersion='report-execution-v1';
export const overlaySchemaSha256='97e0328971091b3fffb67cb8abcc4ece5569348fa99278b61322297380fab901';
const legacyFields=["id","applicationNumber","applicantProfileId","applicantEmail","applicantDisplayName","merchantName","businessType","businessRegistrationNumber","businessRegistrationNumberHash","contactName","phone","phoneHash","businessPhone","lineId","preferredContactMethod","businessAddress","city","merchantDescription","stallName","stallLocation","requestedSlug","estimatedDailyOrders","expectedStartDate","needsMultipleStaff","needsKitchenView","requestedPlanCode","status","riskLevel","riskReasonsJson","publicReviewNote","internalReviewNote","currentStep","termsAccepted","privacyAccepted","dataProcessingAccepted","informationConfirmed","consentedAt","submissionIpHash","submissionDeviceHash","submittedAt","assignedReviewerProfileId","reviewedAt","reviewedByProfileId","approvedAt","approvedOrganizationId","rejectedAt","withdrawnAt","expiresAt","reapplicationAllowed","createdAt","updatedAt"];
const currentFields=["id","applicationNumber","applicantProfileId","applicantEmail","applicantDisplayName","merchantName","businessType","businessRegistrationNumber","businessRegistrationNumberHash","contactName","phone","phoneHash","businessPhone","lineId","preferredContactMethod","businessAddress","city","merchantDescription","stallName","stallLocation","requestedSlug","estimatedDailyOrders","expectedStartDate","needsMultipleStaff","needsKitchenView","requestedPlanCode","status","riskLevel","riskReasonsJson","publicReviewNote","internalReviewNote","currentStep","draftVersion","termsAccepted","privacyAccepted","dataProcessingAccepted","informationConfirmed","consentedAt","submissionIpHash","submissionDeviceHash","submittedAt","assignedReviewerProfileId","reviewedAt","reviewedByProfileId","approvedAt","approvedOrganizationId","rejectedAt","withdrawnAt","expiresAt","reapplicationAllowed","createdAt","updatedAt"];
export function assertApplicationOverlaySchema(bytes=readFileSync('prisma/schema.prisma')){
 if(createHash('sha256').update(bytes).digest('hex')!==overlaySchemaSha256)throw Error('AWESOME_QA_APPLICATION_SCHEMA_UNEXPECTED');
}
export function projectLegacyApplications(rows){
 assertApplicationOverlaySchema();
 return rows.map(row=>{
  if(JSON.stringify(Object.keys(row))!==JSON.stringify(currentFields))throw Error('AWESOME_QA_APPLICATION_SCHEMA_UNEXPECTED');
  const {draftVersion,...legacy}=row;
  if(draftVersion!==0)throw Error('AWESOME_QA_APPLICATION_DEFAULT_DRIFT');
  if(JSON.stringify(Object.keys(legacy))!==JSON.stringify(legacyFields))throw Error('AWESOME_QA_APPLICATION_SCHEMA_UNEXPECTED');
  return legacy;
 });
}
