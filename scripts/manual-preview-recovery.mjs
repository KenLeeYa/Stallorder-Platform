import {readFileSync,readdirSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
const fail=()=>{throw Error('MANUAL_RECOVERY_IDENTITY_INVALID');};
const read=path=>JSON.parse(readFileSync(path,'utf8'));
export function validateRecovery(run,receipts,env){
 const id=env.CLEANUP_RUN_ID;
 if(!/^[1-9][0-9]{0,19}$/.test(id??'')||String(run.id)!==id||run.event!=='workflow_dispatch'||run.status!=='completed'
  ||run.repository?.full_name!==env.GITHUB_REPOSITORY||run.path!=='.github/workflows/ephemeral-preview.yml'
  ||!/^codex\/[A-Za-z0-9._/-]+$/.test(run.head_branch??'')||!/^[a-f0-9]{40}$/.test(run.head_sha??'')
  ||!env.SUPABASE_PARENT_PROJECT_REF||!env.VERCEL_ORG_ID||!env.VERCEL_PROJECT_ID||!receipts.length)fail();
 const key=`manual-${id}`,branches=new Map(),deployments=new Map();
 for(const receipt of receipts){
  if(receipt.resourceKey!==key||receipt.branchName!==key||receipt.gitBranch!==run.head_branch
   ||receipt.parent!==env.SUPABASE_PARENT_PROJECT_REF||receipt.team!==env.VERCEL_ORG_ID||receipt.project!==env.VERCEL_PROJECT_ID
   ||!Array.isArray(receipt.branches)||!Array.isArray(receipt.deployments))fail();
  for(const item of receipt.branches){if(typeof item.id!=='string'||!item.id||item.id===receipt.parent||item.name!==key)fail();branches.set(item.id,item);}
  for(const item of receipt.deployments){if(typeof item.id!=='string'||!/^dpl_[A-Za-z0-9]+$/.test(item.id)||item.project!==receipt.project||item.target==='production')fail();deployments.set(item.id,item);}
 }
 if(branches.size>1)fail();
 const receipt={...receipts.at(-1),branches:[...branches.values()].map(item=>({...item,absent:false})),deployments:[...deployments.values()].map(item=>({...item,absent:false})),
  recoverySource:{repository:run.repository.full_name,workflow:run.path,runId:id,gitBranch:run.head_branch,headSha:run.head_sha},status:'RECOVERY_VERIFIED'};
 return {receipt,environment:{PREVIEW_RESOURCE_KEY:key,PREVIEW_BRANCH_NAME:key,PREVIEW_GIT_BRANCH:run.head_branch}};
}
export function loadRecoveryReceipts(directory,id){
 const result=[];
 for(const phase of ['initial','branch','paired','final']){
  const name=`manual-preview-${phase}-${id}`;
  const match=readdirSync(directory,{withFileTypes:true}).find(entry=>entry.isDirectory()&&entry.name===name);
  if(match)result.push(read(join(directory,name,'manual-resources.json')));
 }
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(process.argv.length!==4)fail();
  const result=validateRecovery(read(resolve(process.argv[2])),loadRecoveryReceipts(resolve(process.argv[3]),process.env.CLEANUP_RUN_ID),process.env);
  mkdirSync('.preview-receipt',{recursive:true});writeFileSync('.preview-receipt/manual-resources.json',JSON.stringify(result.receipt,null,2)+'\n');
  const lines=Object.entries(result.environment).map(([key,value])=>`${key}=${value}`).join('\n')+'\n';
  if(!process.env.GITHUB_ENV)fail();writeFileSync(process.env.GITHUB_ENV,lines,{flag:'a'});
  console.log(JSON.stringify({status:'RECOVERY_VERIFIED',runId:process.env.CLEANUP_RUN_ID,headSha:result.receipt.recoverySource.headSha,receiptsOnly:true}));
 }catch(error){console.error(error.message==='MANUAL_RECOVERY_IDENTITY_INVALID'?error.message:'MANUAL_RECOVERY_RECEIPT_INVALID');process.exitCode=1;}
}
