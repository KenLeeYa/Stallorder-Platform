import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {verifyPreviewVercelAccess} from './delivery-preview-vercel-access.mjs';
const team = 'team_MMfsiG94K9Zy3e6w7Ccc9xY4';
const project = 'prj_uoG4FNJIgnF1LdKRiXnfRaieXnUP';
const token = 'synthetic-preview-credential-value';
const fixture = () => ({team, project, token});
const teamReply = () => ({id:team, slug:'ada76145-8663s-projects'});
const projectReply = () => ({id:project, accountId:team, name:'stallorder-platform'});
function fake(replies = [teamReply(), projectReply()]) {
  const calls=[];
  const request=(options, callback) => {
    const item=replies[calls.length], req=new EventEmitter(), res=new EventEmitter();
    req.destroy=()=>{req.destroyed=true;}; res.destroy=()=>{res.destroyed=true;};
    res.statusCode=item?.status ?? 200; res.headers={'content-encoding':item?.encoding ?? 'identity'};
    res.complete=item?.complete ?? true;
    calls.push({options,req,res});
    req.end=body=>{calls.at(-1).body=body;queueMicrotask(()=>{
      callback(res);
      if(item?.stream) item.stream(res);
      else {res.emit('data',Buffer.from(item?.raw ?? JSON.stringify(item)));res.emit('end');}
    });};
    return req;
  };
  return {calls,request};
}
test('uses the supplied Preview token for two fixed read-only calls and emits no provider payload',async()=>{
  const t=fake(), out=await verifyPreviewVercelAccess(fixture(),t.request);
  assert.deepEqual(t.calls.map(c=>[c.options.hostname,c.options.method,c.options.path,c.body]),[
    ['api.vercel.com','GET','/v2/teams/'+team,undefined],
    ['api.vercel.com','GET','/v9/projects/'+project+'?teamId='+team,undefined],
  ]);
  for(const c of t.calls) assert.equal(c.options.headers.Authorization,'Bearer '+token);
  assert.deepEqual(out,{team,project,readAccessVerified:true,deploymentPermissionProven:false,releaseAuthorized:false});
  assert.ok(!JSON.stringify(out).includes(token));
});
for(const [name,change] of [
  ['wrong team',x=>x.team='team_other'],['wrong project',x=>x.project='prj_other'],
  ['missing token',x=>delete x.token],['empty token',x=>x.token=''],
  ['header injection',x=>x.token=token+'\r\nX-Test:private'],['embedded whitespace',x=>x.token=token.slice(0,10)+' '+token.slice(10)],
  ['expired deadline',x=>x.deadlineAt=Date.now()-1],
]) test('rejects '+name+' before any network call',async()=>{
  const x=fixture(),t=fake();change(x);
  await assert.rejects(verifyPreviewVercelAccess(x,t.request),/PREVIEW_VERCEL_/);assert.equal(t.calls.length,0);
});
for(const [status,encoding,complete,expected] of [
  [301,'identity',true,'HTTP_301'],[302,'identity',true,'HTTP_302'],
  [401,'identity',true,'HTTP_401'],[403,'identity',true,'HTTP_403'],
  [404,'identity',true,'HTTP_404'],[429,'identity',true,'HTTP_429'],[500,'identity',true,'HTTP_500'],
  [200,'gzip',true,'ENCODING'],[200,'identity',false,'INCOMPLETE'],
]) test('fails once without redirect or retry: '+expected,async()=>{
  const t=fake([{status,encoding,complete}]);
  await assert.rejects(verifyPreviewVercelAccess(fixture(),t.request),new RegExp('PREVIEW_VERCEL_'+expected));
  assert.equal(t.calls.length,1);assert.equal(t.calls[0].req.destroyed,true);
});
for(const [name,replies,count] of [
  ['team id',[{...teamReply(),id:'team_other'}],1],
  ['team slug',[{...teamReply(),slug:'other'}],1],
  ['project id',[teamReply(),{...projectReply(),id:'prj_other'}],2],
  ['project owner',[teamReply(),{...projectReply(),accountId:'team_other'}],2],
  ['project name',[teamReply(),{...projectReply(),name:'other'}],2],
  ['project denied',[teamReply(),{status:403,raw:'private'}],2],
]) test('rejects mismatched '+name,async()=>{
  const t=fake(replies);await assert.rejects(verifyPreviewVercelAccess(fixture(),t.request),/PREVIEW_VERCEL_/);
  assert.equal(t.calls.length,count);
});
test('never echoes secrets, provider responses or transport errors',async()=>{
  const marker='private-provider-body-'+token;
  for(const request of [fake([{raw:marker}]).request,()=>{throw new Error(marker);}])
    await assert.rejects(verifyPreviewVercelAccess(fixture(),request),e=>/^PREVIEW_VERCEL_/.test(e.message)&&!e.message.includes(marker)&&!e.message.includes(token));
});
test('limits response bytes',async()=>{
  const t=fake([{stream:r=>r.emit('data',Buffer.alloc(1024*1024+1))}]);
  await assert.rejects(verifyPreviewVercelAccess(fixture(),t.request),/PREVIEW_VERCEL_TOO_LARGE/);
});
test('absolute deadline stops a continuously active response',async()=>{
  let interval;const t=fake([{stream:r=>{interval=setInterval(()=>r.emit('data',Buffer.from('x')),2);}}]);
  try {await assert.rejects(verifyPreviewVercelAccess({...fixture(),deadlineAt:Date.now()+40},t.request),/PREVIEW_VERCEL_DEADLINE/);}
  finally{clearInterval(interval);}
  assert.equal(t.calls[0].req.destroyed,true);
});

test('normalizes clipboard edge whitespace without exposing or changing the opaque credential',async()=>{
 const t=fake();const out=await verifyPreviewVercelAccess({...fixture(),token:' \r\n'+token+'\n\t '},t.request);
 assert.equal(out.readAccessVerified,true);for(const call of t.calls)assert.equal(call.options.headers.Authorization,'Bearer '+token);
});

for(const [status,credential] of [[200,token],[401,token],[200,token+'%0A%0D%25']]) test('CLI verified credential handoff '+status+(credential===token?'':' with escaped command payload'),async()=>{
 const fs=await import('node:fs');const path=await import('node:path');const url=await import('node:url');
 const {spawnSync}=await import('node:child_process');
 const root=path.dirname(url.fileURLToPath(import.meta.url));
 const dir=fs.mkdtempSync(path.join(root,'.preview-access-test-'));
 try {
  const eventFile=path.join(dir,'event.json'),envFile=path.join(dir,'job-env');
  fs.writeFileSync(eventFile,JSON.stringify({pull_request:{number:397,head:{repo:{full_name:'KenLeeYa/Stallorder-Platform'},ref:'codex/conversion-source-checks-20261023'},base:{ref:'staging'}}}));
  const preload=path.join(dir,'transport.mjs');
  fs.writeFileSync(preload,[
   "import https from 'node:https';import {syncBuiltinESMExports} from 'node:module';import {EventEmitter} from 'node:events';",
   "https.request=(options,callback)=>{const req=new EventEmitter();req.destroy=()=>{};req.end=()=>queueMicrotask(()=>{const res=new EventEmitter();res.destroy=()=>{};res.complete=true;res.headers={};res.statusCode="+status+";callback(res);res.emit('data',Buffer.from(JSON.stringify(options.path.startsWith('/v2/')?"+JSON.stringify(teamReply())+":"+JSON.stringify(projectReply())+")));res.emit('end');});return req;};syncBuiltinESMExports();",
  ].join('\n'));
  const run=spawnSync(process.execPath,['--import',url.pathToFileURL(preload).href,url.fileURLToPath(new URL('./delivery-preview-vercel-access.mjs',import.meta.url))],{
   encoding:'utf8',timeout:10000,env:{...process.env,GITHUB_ACTIONS:'true',GITHUB_REPOSITORY:'KenLeeYa/Stallorder-Platform',GITHUB_EVENT_NAME:'pull_request',GITHUB_EVENT_PATH:eventFile,GITHUB_ENV:envFile,PREVIEW_RESOURCE_KEY:'pr-389',VERCEL_ORG_ID:team,VERCEL_PROJECT_ID:project,VERCEL_TOKEN:' \r\n'+credential+'\n\t '},
  });
  assert.equal(run.status,status===200?0:1,run.stderr);
  if(status===200){
   assert.equal(fs.readFileSync(envFile,'utf8'),'DELIVERY_PREVIEW_VERCEL_TOKEN='+credential+'\n');
   const lines=run.stdout.trim().split('\n');assert.equal(lines[0],'::add-mask::'+credential.replaceAll('%','%25'));
   assert.equal(lines.length,2);assert.equal(JSON.parse(lines[1]).readAccessVerified,true);
   assert.equal(JSON.parse(lines[1]).deploymentPermissionProven,false);
  }else{
   assert.equal(fs.existsSync(envFile),false);assert.equal(run.stdout,'');
   assert.match(run.stderr,/PREVIEW_VERCEL_HTTP_401/);assert.ok(!run.stderr.includes(credential));
  }
 }finally{
  assert.equal(path.dirname(path.resolve(dir)),path.resolve(root));
  assert.ok(path.basename(dir).startsWith('.preview-access-test-'));
  fs.rmSync(dir,{recursive:true});
 }
});
