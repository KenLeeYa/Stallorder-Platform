import { afterEach, expect, test, vi } from 'vitest';
import { runInNewContext } from 'node:vm';

// Synthetic lifecycle proof only: this does not run PostgreSQL or application CAS.
const state=vi.hoisted(()=>({events:[],collision:false,guardFailure:false,writeFailure:false,closeFailure:false}));
vi.mock('node:process',()=>({loadEnvFile(){}}));
vi.mock('node:fs',()=>({
 existsSync:()=>false,
 openSync:()=>{state.events.push('reserve');if(state.collision)throw Object.assign(Error('occupied'),{code:'EEXIST'});return 42;},
 writeFileSync:fd=>{expect(fd).toBe(42);state.events.push('write');if(state.writeFailure)throw Error('write failed');},
 closeSync:fd=>{expect(fd).toBe(42);state.events.push('close');if(state.closeFailure)throw Error('close failed');},
 readFileSync:()=>'',
}));
vi.mock('node:child_process',()=>({spawnSync:()=>{state.events.push('sql');return {status:1,stdout:'',stderr:'synthetic wrong denial'};}}));
vi.mock('../../docs/awesome-optimization/qa/live-fixture-guard.mjs',()=>({
 openGuardedDatabase:async()=>{state.events.push('target');return {$disconnect:async()=>state.events.push('disconnect')};},
 verifyLiveFixture:async()=>{state.events.push('guard');if(state.guardFailure)throw Error('guard failed');return {receipt:{syntheticLocalOnly:true}};},
}));
vi.mock('../responsive-build-provenance.mjs',()=>({readResponsiveBuildProvenance:()=>({syntheticLocalOnly:true})}));
const argv=[...process.argv],exitCode=process.exitCode;
afterEach(()=>{process.argv=argv;process.exitCode=exitCode;vi.restoreAllMocks();});
for(const [name,file]of [['cas','batch-3/database-cas.mjs'],['constraints','batch-4a/database-constraints.mjs']]){
 const run=async()=>{vi.resetModules();process.argv=[process.execPath,file,'synthetic'];vi.spyOn(console,'log').mockImplementation(()=>{});if(name==='cas')await import('./batch-3/database-cas.mjs');else await import('./batch-4a/database-constraints.mjs');};
 test(`${name}: receipt collision after verified target prevents all mutations`,async()=>{
  Object.assign(state,{events:[],collision:true,guardFailure:false,writeFailure:false,closeFailure:false});
  await expect(run()).rejects.toMatchObject({code:'EEXIST',message:name==='cas'?'BATCH3_RECEIPT_EXISTS':'IMMUTABLE_RECEIPT_EXISTS'});
  expect(state.events).toEqual(['target','guard','reserve','disconnect']);
 });
 test(`${name}: failed target guard neither reserves nor writes a receipt and disconnects`,async()=>{
  Object.assign(state,{events:[],collision:false,guardFailure:true,writeFailure:false,closeFailure:false});
  await expect(run()).rejects.toThrow('guard failed');
  expect(state.events).toEqual(['target','guard','disconnect']);
 });
}
test('constraints: failed SQL keeps its primary assertion when receipt writing and close fail',async()=>{
 Object.assign(state,{events:[],collision:false,guardFailure:false,writeFailure:true,closeFailure:true});
 vi.resetModules();process.argv=[process.execPath,'constraints','synthetic'];
 await expect(import('./batch-4a/database-constraints.mjs')).rejects.toMatchObject({name:'AssertionError',receiptWriteFailed:true,cleanupFailed:true});
 expect(state.events).toEqual(['target','guard','reserve','sql','write','close','disconnect']);
});
test('fixture freeze collision reads the winner and rejects different digest without overwrite',async()=>{
 const fs=await vi.importActual('node:fs');
 const source=fs.readFileSync(new URL('./batch-2/fixture.mjs',import.meta.url),'utf8');
 const fragment=source.slice(source.indexOf('  const file=`'),source.indexOf('  console.log(JSON.stringify({marker:frozen.marker'));
 for(const digest of ['same','different']){
  let reads=0;
  const execute=()=>runInNewContext(fragment,{output:'synthetic',frozen:{digest:'same'},JSON,
   writeFileSync:(_file,_bytes,options)=>{expect(options.flag).toBe('wx');throw Object.assign(Error('winner'),{code:'EEXIST'});},
   readFileSync:()=>{reads++;return JSON.stringify({digest});},
  });
  if(digest==='same')expect(execute).not.toThrow();else expect(execute).toThrow('AWESOME_FIXTURE_DRIFT');
  expect(reads).toBe(1);
 }
 const fail=()=>runInNewContext(fragment,{output:'synthetic',frozen:{digest:'same'},JSON,
  writeFileSync:()=>{throw Object.assign(Error('denied'),{code:'EACCES'});},readFileSync:()=>{throw Error('must not read');}});
 expect(fail).toThrow('denied');
});
test('capture snapshot atomically maps collision and only treats ENOENT as an absent source',async()=>{
 const fs=await vi.importActual('node:fs');
 const source=fs.readFileSync(new URL('./batch-2/capture.mjs',import.meta.url),'utf8');
 const body=source.slice(source.indexOf(' const snapshot ='),source.indexOf('\n});'));
 const run=(read,write)=>runInNewContext(`(path=>{${body}})('source.ts')`,{directory:'synthetic',readFileSync:read,writeFileSync:write,createHash:()=>({update(){return this;},digest:()=> 'synthetic-hash'})});
 let writes=0;
 expect(()=>run(()=>Buffer.from('source'),(_file,_bytes,options)=>{writes++;expect(options.flag).toBe('wx');throw Object.assign(Error('occupied'),{code:'EEXIST'});})).toThrow('PREIMAGE_ALREADY_CAPTURED:source.ts');
 expect(writes).toBe(1);
 const absent=run(()=>{throw Object.assign(Error('missing'),{code:'ENOENT'});},()=>{throw Error('must not write');});
 expect(absent).toMatchObject({existed:false,snapshot:null});
 expect(()=>run(()=>{throw Object.assign(Error('denied'),{code:'EACCES'});},()=>{})).toThrow('denied');
});
