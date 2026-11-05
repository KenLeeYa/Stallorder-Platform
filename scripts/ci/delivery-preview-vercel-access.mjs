import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {request} from 'node:https';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {verifyPreviewInvocation} from './delivery-preview-binding.mjs';
const TEAM = 'team_MMfsiG94K9Zy3e6w7Ccc9xY4';
const PROJECT = 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP';

// GET access is necessary, but does not prove permission to create a deployment.
// The existing environment approval and deployment/readback/acceptance gates remain required.
export async function verifyPreviewVercelAccess({team, project, token, deadlineAt=Date.now()+20000}, transport=request) {
  try {
    assert.equal(team,TEAM); assert.equal(project,PROJECT);
    assert.ok(typeof token==='string' && token.length>=20 && token.length<=4096 && /^[\x21-\x7e]+$/.test(token));
  } catch {throw new Error('PREVIEW_VERCEL_INPUT');}
  async function read(apiPath) {
    const remaining=Math.min(20000,deadlineAt-Date.now());
    if(!Number.isFinite(remaining)||remaining<=0) throw new Error('PREVIEW_VERCEL_DEADLINE');
    return new Promise((resolve,reject)=>{
      let req,res,timer,settled=false;
      const finish=(error,value)=>{
        if(settled)return;settled=true;clearTimeout(timer);
        if(error){res?.destroy();req?.destroy();reject(error);}else resolve(value);
      };
      timer=setTimeout(()=>finish(new Error('PREVIEW_VERCEL_DEADLINE')),remaining);
      try {
        req=transport({hostname:'api.vercel.com',path:apiPath,method:'GET',headers:{
          Authorization:'Bearer '+token,Accept:'application/json','Accept-Encoding':'identity',
        }},response=>{
          res=response;res.on('error',()=>finish(new Error('PREVIEW_VERCEL_STREAM')));
          if(res.statusCode!==200){finish(new Error('PREVIEW_VERCEL_HTTP_'+res.statusCode));return;}
          if((res.headers['content-encoding']??'identity')!=='identity'){finish(new Error('PREVIEW_VERCEL_ENCODING'));return;}
          const parts=[];let bytes=0;
          res.on('data',chunk=>{
            if(settled)return;bytes+=chunk.length;
            if(bytes>1024*1024)finish(new Error('PREVIEW_VERCEL_TOO_LARGE'));else parts.push(chunk);
          });
          res.on('end',()=>{
            if(settled)return;
            if(!res.complete){finish(new Error('PREVIEW_VERCEL_INCOMPLETE'));return;}
            try {finish(null,JSON.parse(Buffer.concat(parts).toString('utf8')));}
            catch {finish(new Error('PREVIEW_VERCEL_RESPONSE'));}
          });
          res.on('close',()=>{if(!res.complete)finish(new Error('PREVIEW_VERCEL_INCOMPLETE'));});
        });
        req.on('error',()=>finish(new Error('PREVIEW_VERCEL_TRANSPORT')));
        if(settled)req.destroy();else req.end();
      }catch{finish(new Error('PREVIEW_VERCEL_TRANSPORT'));}
    });
  }
  const actualTeam=await read('/v2/teams/'+TEAM);
  if(actualTeam?.id!==TEAM||actualTeam?.slug!=='ada76145-8663s-projects')throw new Error('PREVIEW_VERCEL_TEAM');
  const actualProject=await read('/v9/projects/'+PROJECT+'?teamId='+TEAM);
  if(actualProject?.id!==PROJECT||actualProject?.accountId!==TEAM||actualProject?.name!=='stallorder-platform')
    throw new Error('PREVIEW_VERCEL_PROJECT');
  return {team:TEAM,project:PROJECT,readAccessVerified:true,deploymentPermissionProven:false,releaseAuthorized:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    assert.equal(process.env.GITHUB_ACTIONS,'true');
    assert.equal(process.env.PREVIEW_RESOURCE_KEY,'pr-389');
    const eventBytes=readFileSync(process.env.GITHUB_EVENT_PATH);assert.ok(eventBytes.length<=131072);
    const e=JSON.parse(eventBytes);
    verifyPreviewInvocation({repository:process.env.GITHUB_REPOSITORY,actor:process.env.GITHUB_ACTOR,
      event:process.env.GITHUB_EVENT_NAME,ref:process.env.GITHUB_REF,headRepo:e.pull_request?.head?.repo?.full_name,
      headBranch:e.pull_request?.head?.ref,baseBranch:e.pull_request?.base?.ref,number:e.pull_request?.number});
    console.log(JSON.stringify(await verifyPreviewVercelAccess({team:process.env.VERCEL_ORG_ID,
      project:process.env.VERCEL_PROJECT_ID,token:process.env.VERCEL_TOKEN})));
  }catch(error){
    const code=/^PREVIEW_VERCEL_[A-Z0-9_]+$/.test(error?.message??'')?error.message:'PREVIEW_VERCEL_CONTEXT';
    console.error(code+': Preview credential or target could not be verified; no automatic retry.');
    process.exitCode=1;
  }
}
