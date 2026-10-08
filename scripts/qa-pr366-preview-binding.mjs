import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';
const parent='eyuctbnlvnbnivwasvqr',team='team_MMfsiG94K9Zy3e6w7Ccc9xY4',project='prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP';
const fail=code=>{throw Error(code);};
const aliasNames=response=>{if(!Array.isArray(response?.aliases)||response.pagination?.next)fail('BINDING_ALIASES_INVALID');return response.aliases.map(row=>{if(typeof row.alias!=='string'||!row.alias)fail('BINDING_ALIASES_INVALID');return row.alias;}).sort();};
export function databaseProof(config, privateUrl, childRef, resourceKey){
 const service=new URL(config.SUPABASE_URL),raw=new URL(config.POSTGRES_URL),actual=new URL(privateUrl);
 const identity=url=>`${url.hostname}:${url.port||'5432'}/postgres|${decodeURIComponent(url.username)}`;
 const direct=actual.hostname===`db.${childRef}.supabase.co`&&actual.username==='postgres'&&(actual.port||'5432')==='5432';
 const pooler=actual.hostname.endsWith('.pooler.supabase.com')&&decodeURIComponent(actual.username)===`postgres.${childRef}`;
 if(service.origin!==`https://${childRef}.supabase.co`||service.pathname!=='/'||service.search||service.hash
  ||!['postgres:','postgresql:'].includes(raw.protocol)||!['postgres:','postgresql:'].includes(actual.protocol)
  ||raw.pathname!=='/postgres'||actual.pathname!=='/postgres'||!raw.password||!actual.password
  ||identity(raw)!==identity(actual)||raw.password!==actual.password||(!direct&&!pooler)||actual.searchParams.get('sslmode')!=='require')fail('BINDING_DATABASE_DRIFT');
 return {projectRef:childRef,host:actual.hostname,database:'postgres',username:decodeURIComponent(actual.username),port:actual.port||'5432',ownerResourceKey:resourceKey,
  identityFingerprint:createHash('sha256').update(identity(actual)).digest('hex'),provider:'supabase-cli',operation:'branches get',parentProjectRef:parent};
}
export function publicBackendConfigShape(config){
 const rows=Array.isArray(config?.envs)?config.envs.filter(row=>row?.key==='NEXT_PUBLIC_SUPABASE_URL'):[];
 return {envsArray:Array.isArray(config?.envs),paginationNextTruthy:Boolean(config?.pagination?.next),publicKeyRowCount:rows.length,
  productionPublicRowCount:rows.filter(row=>Array.isArray(row.target)&&row.target.includes('production')).length,
  rows:rows.map(row=>({targetArray:Array.isArray(row.target),productionTarget:Array.isArray(row.target)&&row.target.includes('production'),
   idPresent:Boolean(row.id),idString:typeof row.id==='string',typePresent:Boolean(row.type),typeString:typeof row.type==='string',
   updatedAtPresent:Object.hasOwn(row,'updatedAt'),updatedAtFiniteNumber:Number.isFinite(row.updatedAt),updatedAtNumberType:typeof row.updatedAt==='number',
   valuePresent:Object.hasOwn(row,'value'),valueString:typeof row.value==='string',valueNonEmptyString:typeof row.value==='string'&&Boolean(row.value)}))};
}
export async function capturePublicBackendConfigFingerprint(api){
 const config=await api(`/v9/projects/${project}/env?teamId=${team}`);
 const rows=config?.envs?.filter(row=>row.key==='NEXT_PUBLIC_SUPABASE_URL'&&Array.isArray(row.target)&&row.target.includes('production'));
 if(config?.pagination?.next||rows?.length!==1)fail('BINDING_PUBLIC_CONFIG_INVALID');
 const row=rows[0];
 if(!row.id||!row.type||!Number.isFinite(row.updatedAt)||typeof row.value!=='string'||!row.value)fail('BINDING_PUBLIC_CONFIG_INVALID');
 // The provider intentionally cannot decrypt sensitive variables. Compare unchanged metadata,
 // never claim this fingerprint proves a fresh server database connection or expose its value.
 return createHash('sha256').update(JSON.stringify({id:row.id,key:row.key,type:row.type,target:[...row.target].sort(),updatedAt:row.updatedAt,value:row.value})).digest('hex');
}
export async function capturePrimaryBaseline(expected,api,now=new Date()){
 if(!/^dpl_[A-Za-z0-9]+$/.test(expected.deploymentId??'')||!/^[a-f0-9]{40}$/.test(expected.sha??''))fail('BINDING_PRIMARY_BASELINE_REQUIRED');
 const actualProject=await api(`/v9/projects/${project}?teamId=${team}`);
 if(actualProject?.id!==project||actualProject.accountId!==team||actualProject.targets?.production?.id!==expected.deploymentId)fail('BINDING_PRIMARY_CHANGED');
 const deployment=await api(`/v13/deployments/${encodeURIComponent(expected.deploymentId)}?teamId=${team}`);
 if(deployment?.id!==expected.deploymentId||deployment.projectId!==project||deployment.target!=='production'||deployment.readyState!=='READY'
  ||(deployment.meta?.githubCommitSha??deployment.meta?.git_commit)!==expected.sha)fail('BINDING_PRIMARY_CHANGED');
 return {projectId:actualProject.id,teamId:actualProject.accountId,deploymentId:deployment.id,sha:expected.sha,
  aliases:aliasNames(await api(`/v2/deployments/${encodeURIComponent(deployment.id)}/aliases?teamId=${team}`)),publicBackendConfigFingerprint:await capturePublicBackendConfigFingerprint(api),capturedAt:now.toISOString(),provider:'VERCEL_TEAM_SCOPED_GET'};
}
export async function captureBinding(receipt,selection,baseline,adapters,now=new Date()){
 if(receipt.parent!==parent||receipt.team!==team||receipt.project!==project||receipt.gitBranch!=='codex/integrated-production-20261002'
  ||!/^manual-[1-9][0-9]*$/.test(receipt.resourceKey??'')||receipt.branchName!==receipt.resourceKey||receipt.status!=='CAPTURED'||!(Date.parse(receipt.expiresAt)>now.getTime())
  ||!receipt.branches?.some(row=>row.id===selection.childRef&&!row.absent&&row.id!==parent)
  ||!receipt.deployments?.some(row=>row.id===selection.deploymentId&&!row.absent&&row.target==='preview'))fail('BINDING_RECEIPT_INVALID');
 if(!baseline?.projectId||!baseline.deploymentId||!Array.isArray(baseline.aliases)||baseline.aliases.some(alias=>typeof alias!=='string'||!alias)||baseline.deploymentId===selection.deploymentId)fail('BINDING_PRIMARY_BASELINE_REQUIRED');
 const source=await adapters.source();
 if(!/^[a-f0-9]{40}$/.test(source.sha??'')||!/^[a-f0-9]{40}$/.test(source.tree??''))fail('BINDING_SOURCE_INVALID');
 const branches=await adapters.branches(parent);
 if(!Array.isArray(branches))fail('BINDING_CHILD_READBACK_INVALID');
 const matches=branches.filter(row=>row.name===receipt.branchName);
 if(matches.length!==1||matches[0].project_ref!==selection.childRef||matches[0].with_data!==false||matches[0].git_branch!==receipt.gitBranch
  ||(matches[0].parent_project_ref!==undefined&&matches[0].parent_project_ref!==parent))fail('BINDING_CHILD_IDENTITY_DRIFT');
 const actualProject=await adapters.api(`/v9/projects/${encodeURIComponent(project)}?teamId=${team}`);
 if(actualProject?.id!==project||actualProject.accountId!==team)fail('BINDING_PROJECT_OWNER_DRIFT');
 const deployment=await adapters.api(`/v13/deployments/${encodeURIComponent(selection.deploymentId)}?teamId=${team}`);
 if(deployment?.id!==selection.deploymentId||deployment.projectId!==project||deployment.readyState!=='READY'||!['preview',null].includes(deployment.target)
  ||deployment.meta?.stallorderPreviewResource!==receipt.resourceKey||deployment.meta?.githubCommitRef!==receipt.gitBranch||deployment.meta?.githubCommitSha!==source.sha)fail('BINDING_DEPLOYMENT_DRIFT');
 const origin=new URL(`https://${deployment.url}`);
 if(origin.hostname!==deployment.url||!origin.hostname.endsWith('.vercel.app')||origin.port||origin.pathname!=='/'||origin.username||origin.password)fail('BINDING_ORIGIN_INVALID');
 const aliases=aliasNames(await adapters.api(`/v2/deployments/${encodeURIComponent(deployment.id)}/aliases?teamId=${team}`));
 if(aliases.some(alias=>!alias.endsWith('.vercel.app')||baseline.aliases.includes(alias)))fail('BINDING_PRODUCTION_ALIAS_DENIED');
 const primary=await adapters.api(`/v9/projects/${encodeURIComponent(baseline.projectId)}?teamId=${team}`);
 if(primary?.id!==baseline.projectId||primary.accountId!==team||primary.targets?.production?.id!==baseline.deploymentId)fail('BINDING_PRIMARY_CHANGED');
 const primaryAliases=aliasNames(await adapters.api(`/v2/deployments/${encodeURIComponent(baseline.deploymentId)}/aliases?teamId=${team}`));
 if(JSON.stringify(primaryAliases)!==JSON.stringify([...baseline.aliases].sort()))fail('BINDING_PRIMARY_CHANGED');
 const child=matches[0];
 const database=adapters.databaseUrl?databaseProof(await adapters.branchGet(receipt.branchName,parent),adapters.databaseUrl,child.project_ref,receipt.resourceKey):undefined;
 return {origin:origin.origin,resourceKey:receipt.resourceKey,childRef:selection.childRef,deploymentId:deployment.id,sha:source.sha,tree:source.tree,
  providerReadback:'VERIFIED',productionAlias:false,dataLess:true,readback:{verifiedAt:now.toISOString(),readyState:deployment.readyState,
   child:{project_ref:child.project_ref,name:child.name,with_data:child.with_data,git_branch:child.git_branch,...(child.parent_project_ref===undefined?{}:{parent_project_ref:child.parent_project_ref})},
   childScope:{provider:'supabase-cli',operation:'branches list',parentProjectRef:parent},
   deployment:{id:deployment.id,projectId:deployment.projectId,teamId:actualProject.accountId,target:deployment.target===null?'preview':deployment.target,rawTarget:deployment.target,origin:origin.origin,meta:{stallorderPreviewResource:deployment.meta.stallorderPreviewResource,githubCommitRef:deployment.meta.githubCommitRef,githubCommitSha:deployment.meta.githubCommitSha}},
   ...(database?{database}:{}),source,aliases,primary:{projectId:primary.id,deploymentId:primary.targets.production.id,aliases:primaryAliases}}};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{
  if(!process.env.VERCEL_TOKEN)fail('BINDING_ARGUMENTS_INVALID');
  const api=async path=>{const response=await fetch(`https://api.vercel.com${path}`,{headers:{Authorization:`Bearer ${process.env.VERCEL_TOKEN}`},signal:AbortSignal.timeout(30000),redirect:'error'});if(!response.ok)fail('BINDING_PROVIDER_READBACK_FAILED');return response.json();};
  let result,output;
  if(process.argv[2]==='diagnose-public-config'&&process.argv.length===3){
   console.log(JSON.stringify(publicBackendConfigShape(await api(`/v9/projects/${project}/env?teamId=${team}`))));
  }else if(process.argv[2]==='capture-baseline'&&process.argv.length===5){
   result=await capturePrimaryBaseline(JSON.parse(readFileSync(process.argv[3],'utf8')),api);output=process.argv[4];
  }else if(process.argv[2]==='capture-binding'&&process.argv.length===7){
   const receipt=JSON.parse(readFileSync(process.argv[3],'utf8')),selection=JSON.parse(readFileSync(process.argv[4],'utf8')),baseline=JSON.parse(readFileSync(process.argv[5],'utf8'));output=process.argv[6];
   result=await captureBinding(receipt,selection,baseline,{source:()=>({sha:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),tree:execFileSync('git',['rev-parse','HEAD^{tree}'],{encoding:'utf8'}).trim()}),
    branches:ref=>JSON.parse(execFileSync('supabase',['branches','list','--project-ref',ref,'--output','json','--log-level','error'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000})),
    databaseUrl:process.env.PR366_CHILD_DATABASE_URL,
    branchGet:(name,ref)=>JSON.parse(execFileSync('supabase',['branches','get',name,'--project-ref',ref,'--output','json','--log-level','error'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:30000})),api});
  }else fail('BINDING_ARGUMENTS_INVALID');
  if(output){writeFileSync(output,JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log('BINDING_READBACK_VERIFIED');}
 }catch(error){console.error(/^BINDING_[A-Z_]+$/.test(error.message)?error.message:'BINDING_PROVIDER_READBACK_FAILED');process.exitCode=1;}
}
