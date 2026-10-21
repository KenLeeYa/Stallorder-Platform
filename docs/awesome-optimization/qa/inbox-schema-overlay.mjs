import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const applicationOverlayVersion='personal-inbox-v1';
export const overlaySchemaSha256='a521bedc84d77249c13e59c0671083d7762ea30bad542553d0789aa97b93f3c6';
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
