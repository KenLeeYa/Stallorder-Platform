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
  ['header injection',x=>x.token=token+'\r\nX-Test:private'],['whitespace',x=>x.token=token+' '],
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
