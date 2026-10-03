import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
export const applicationOverlayVersion='native-session-audience-v1';
export const overlaySchemaSha256='0b566b681454042f6c658b246a1c543d89e24a0b6a878495e02909a03dd7ed42';
const legacyFields=["id","applicationNumber","applicantProfileId","applicantEmail","applicantDisplayName","merchantName","businessType","businessRegistrationNumber","businessRegistrationNumberHash","contactName","phone","phoneHash","businessPhone","lineId","preferredContactMethod","businessAddress","city","merchantDescription","stallName","stallLocation","requestedSlug","estimatedDailyOrders","expectedStartDate","needsMultipleStaff","needsKitchenView","requestedPlanCode","status","riskLevel","riskReasonsJson","publicReviewNote","internalReviewNote","currentStep","termsAccepted","privacyAccepted","dataProcessingAccepted","informationConfirmed","consentedAt","submissionIpHash","submissionDeviceHash","submittedAt","assignedReviewerProfileId","reviewedAt","reviewedByProfileId","approvedAt","approvedOrganizationId","rejectedAt","withdrawnAt","expiresAt","reapplicationAllowed","createdAt","updatedAt"];
const currentFields=["id","applicationNumber","applicantProfileId","applicantEmail","applicantDisplayName","merchantName","businessType","businessRegistrationNumber","businessRegistrationNumberHash","contactName","phone","phoneHash","businessPhone","lineId","preferredContactMethod","businessAddress","city","merchantDescription","stallName","stallLocation","requestedSlug","estimatedDailyOrders","expectedStartDate","needsMultipleStaff","needsKitchenView","requestedPlanCode","status","riskLevel","riskReasonsJson","publicReviewNote","internalReviewNote","currentStep","draftVersion","termsAccepted","privacyAccepted","dataProcessingAccepted","informationConfirmed","consentedAt","submissionIpHash","submissionDeviceHash","submittedAt","assignedReviewerProfileId","reviewedAt","reviewedByProfileId","approvedAt","approvedOrganizationId","rejectedAt","withdrawnAt","expiresAt","reapplicationAllowed","createdAt","updatedAt"];
export function assertApplicationOverlaySchema(bytes=readFileSync('prisma/schema.prisma'),reviewedSchemaSha256=overlaySchemaSha256){
 if(createHash('sha256').update(bytes).digest('hex')!==reviewedSchemaSha256)throw Error('AWESOME_QA_APPLICATION_SCHEMA_UNEXPECTED');
}
export function projectLegacyApplications(rows,reviewedSchema){
 assertApplicationOverlaySchema(reviewedSchema?.bytes,reviewedSchema?.sha256);
 return rows.map(row=>{
  if(JSON.stringify(Object.keys(row))!==JSON.stringify(currentFields))throw Error('AWESOME_QA_APPLICATION_SCHEMA_UNEXPECTED');
  const {draftVersion,...legacy}=row;
  if(draftVersion!==0)throw Error('AWESOME_QA_APPLICATION_DEFAULT_DRIFT');
  if(JSON.stringify(Object.keys(legacy))!==JSON.stringify(legacyFields))throw Error('AWESOME_QA_APPLICATION_SCHEMA_UNEXPECTED');
  return legacy;
 });
}
