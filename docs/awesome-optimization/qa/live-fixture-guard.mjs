import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assertResponsiveQaTarget } from '../../../scripts/responsive-qa-target.mjs';
import {assertApplicationOverlaySchema,projectLegacyApplications,applicationOverlayVersion,overlaySchemaSha256} from './product-feedback-schema-overlay-v1.mjs';
export const fixedDigest='f04f523f7f97c1173e97fcb57a659b1afff446a8754f8c4f05950dacbfeb8396';
const hash=value=>createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export const actors={
 owner:{id:'55555555-5555-4555-8555-555555555551',email:'owner@stallorder.test',isActive:true,platformRole:null},
 admin:{id:'55555555-5555-4555-8555-555555555554',email:'platform.admin@stallorder.test',isActive:true,platformRole:'PLATFORM_ADMIN'},
 parity:{id:'21a61e14-0fb8-40a0-8da8-972ebd73aac8',email:'awesome-b2-parity@stallorder.test',isActive:true,platformRole:null},
};
const memberships=[
 {id:'6d3fa14b-8ec6-409d-b9d6-76803bcb3e1c',profileId:actors.parity.id,organizationId:'79fda7ce-a7be-46c6-8809-100eeab5e43e',role:'ORGANIZATION_OWNER',allStalls:true,isActive:true},
 {id:'d52f1d29-24b1-46c5-beb3-e71b0d1cc4f6',profileId:actors.owner.id,organizationId:'3a565732-cf45-4c8f-8e13-50c677ad9719',role:'ORGANIZATION_OWNER',allStalls:true,isActive:true},
 {id:'fd37c92a-e879-4a6a-8f30-033ff57749c3',profileId:actors.owner.id,organizationId:'c670dfe3-5d84-42cc-80db-815c07dee2c8',role:'ORGANIZATION_OWNER',allStalls:true,isActive:true},
];
export async function openGuardedDatabase(){
 assertResponsiveQaTarget(process.env);
 for(const key of ['DATABASE_URL','DIRECT_URL','DR_DATABASE_URL','DR_DIRECT_URL'])if(process.env[key]){const u=new URL(process.env[key]);if(!['localhost','127.0.0.1'].includes(u.hostname)||u.port!=='56822'||u.pathname!=='/postgres')throw Error('AWESOME_QA_READ_TARGET_DENIED');}
 const project='stallorder-responsive-20260930';for(const [name,port,key]of [[`supabase_db_${project}`,'56822','5432/tcp'],[`supabase_kong_${project}`,'56821','8000/tcp']]){const v=JSON.parse(execFileSync('docker',['inspect',name],{encoding:'utf8'}));if(v.length!==1||!v[0].State.Running||v[0].Config.Labels['com.supabase.cli.project']!==project||v[0].NetworkSettings.Ports[key]?.[0]?.HostPort!==port)throw Error('AWESOME_QA_DOCKER_IDENTITY_DENIED');}
 assertApplicationOverlaySchema();
 const {PrismaClient}=await import('@prisma/client');return new PrismaClient();
}
export async function verifyLiveFixture(db){
 const bytes=readFileSync('.superpowers/sdd/2026-10-01-awesome-optimization/batch-2/fixture-freeze.json');
 if(hash(bytes.toString())!=='aa1c7924225d094d78ff979f5faf9828b6aec2e6742f75670058b0e296afa2ed')throw Error('AWESOME_QA_FIXED_IDS_MISMATCH');
 const fixed=JSON.parse(bytes);if(fixed.digest!==fixedDigest)throw Error('AWESOME_QA_FIXED_CORPUS_MISMATCH');
 const dataset={};const organizations=fixed.organizations,stalls=fixed.stalls;
 for(const [name,where]of Object.entries({organization:{id:{in:organizations}},stall:{id:{in:stalls}},product:{organizationId:{in:organizations}},productTranslation:{organizationId:{in:organizations}},stallProduct:{organizationId:{in:organizations}},order:{organizationId:{in:organizations}},merchantApplication:{id:{in:fixed.recordIds.merchantApplication}}}))dataset[name]=await db[name].findMany({where,orderBy:{id:'asc'}});
 dataset.merchantApplication=projectLegacyApplications(dataset.merchantApplication);
 if(hash(dataset)!==fixedDigest||Object.entries(fixed.counts).some(([k,n])=>dataset[k].length!==n)||Object.entries(fixed.recordIds).some(([k,ids])=>JSON.stringify(dataset[k].map(v=>v.id))!==JSON.stringify(ids)))throw Error('AWESOME_QA_LIVE_CORPUS_DRIFT');
 const profiles=await db.profile.findMany({where:{id:{in:Object.values(actors).map(v=>v.id)}},select:{id:true,email:true,isActive:true,platformRole:true},orderBy:{email:'asc'}});
 if(JSON.stringify(profiles)!==JSON.stringify(Object.values(actors).sort((a,b)=>a.email.localeCompare(b.email))))throw Error('AWESOME_QA_LIVE_PRINCIPAL_MISMATCH');
 const actual=await db.organizationMembership.findMany({where:{profileId:{in:Object.values(actors).map(v=>v.id)},organizationId:{in:[...organizations,memberships[0].organizationId]}},select:{id:true,profileId:true,organizationId:true,role:true,allStalls:true,isActive:true},orderBy:{id:'asc'}});
 if(JSON.stringify(actual)!==JSON.stringify(memberships))throw Error('AWESOME_QA_LIVE_ROLE_MISMATCH');
 const parity=await db.stall.findUnique({where:{id:'ad0571f1-5073-4656-8b86-98b37a7c0bb6'},select:{organizationId:true,slug:true,orderingEnabled:true,businessStatus:true}});
 if(!parity||parity.organizationId!==memberships[0].organizationId||parity.slug!=='awesome-b2-parity'||parity.orderingEnabled||parity.businessStatus!=='CLOSED')throw Error('AWESOME_QA_PARITY_SCOPE_MISMATCH');
 return {fixed,receipt:{liveCorpusDigest:fixedDigest,counts:fixed.counts,actorIds:Object.values(actors).map(v=>v.id),roleIds:memberships.map(v=>v.id),applicationOverlay:{version:applicationOverlayVersion,schemaSha256:overlaySchemaSha256,excludedOnly:'draftVersion',original201ExpectedValue:0},verifiedAt:new Date().toISOString()}};
}
export async function bindOwnedSession(db,context,actor,prior){
 if(!Object.values(actors).some(v=>JSON.stringify(v)===JSON.stringify(actor)))throw Error('AWESOME_QA_UNOWNED_ACTOR');
 const cookies=(await context.cookies()).filter(v=>v.domain==='127.0.0.1'&&v.path==='/');const token=cookies.find(v=>v.name==='stallorder_session')?.value,device=cookies.find(v=>v.name==='stallorder_auth_device')?.value;
 if(!token)throw Error('AWESOME_QA_SESSION_MISSING');
 const session=await db.authSession.findUnique({where:{tokenHash:hash(token)},select:{id:true,profileId:true,deviceId:true,revokedAt:true,expiresAt:true,profileSessionVersion:true,profile:{select:{id:true,isActive:true,sessionVersion:true,email:true,platformRole:true}}}});
 if(!session||session.profileId!==actor.id||session.profile.id!==actor.id||session.profile.email!==actor.email||session.profile.platformRole!==actor.platformRole||!session.profile.isActive||session.revokedAt||session.expiresAt<=new Date()||session.profileSessionVersion!==session.profile.sessionVersion||session.deviceId!==device)throw Error('AWESOME_QA_OWNED_SESSION_MISMATCH');
 const identity={principalKey:hash(['principal',actor.id]),sessionEpoch:hash(['session',session.id])};
 if(prior&&JSON.stringify(prior)!==JSON.stringify(identity))throw Error('AWESOME_QA_SESSION_CHANGED');return identity;
}
export function assertScopeIdentity(scope,identity,context){if(scope?.principalKey!==identity.principalKey||scope?.sessionEpoch!==identity.sessionEpoch||JSON.stringify(scope.context)!==JSON.stringify(context))throw Error('AWESOME_QA_AUTHENTICATED_SCOPE_MISMATCH');}
