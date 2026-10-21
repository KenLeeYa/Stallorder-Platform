import { expect, test } from 'vitest';
import { validateResponsiveBuildProvenance } from '../../responsive-build-provenance.mjs';
const sha='c'.repeat(64);
const identity={sourceSha256:sha,inputs:[{path:'src/example.ts',sha256:'d'.repeat(64)}]};
const frozen={mode:'frozen-source-v1',head:'a'.repeat(40),tree:'b'.repeat(40),buildId:'build-dirty',productSourceClean:false,sourceBefore:identity,sourceAfter:identity,artifactSha256:'e'.repeat(64),target:{app:'http://127.0.0.1:3026',database:'127.0.0.1:56822/postgres',primaryApi:'http://127.0.0.1:56821'}};
const current={...frozen,sourceIdentity:identity};
test('explicit expected frozen source permits truthful dirty input',()=>{
 expect(validateResponsiveBuildProvenance(frozen,current,{expectedSourceSha256:sha})).toMatchObject({productSourceClean:false,mode:'frozen-source-v1'});
});
test('legacy reader still rejects dirty source',()=>expect(()=>validateResponsiveBuildProvenance(frozen,current)).toThrow());
test.each([
 ['source changed',{...current,sourceIdentity:{...identity,sourceSha256:'f'.repeat(64)}}],
 ['artifact changed',{...current,artifactSha256:'f'.repeat(64)}],
 ['artifact missing',{...current,artifactSha256:undefined}],
 ['wrong target',{...current,target:{...current.target,database:'127.0.0.1:55722/postgres'}}],
 ['build changed',{...current,buildId:'other'}],
])('frozen reader refuses %s',(_,value)=>expect(()=>validateResponsiveBuildProvenance(frozen,value,{expectedSourceSha256:sha})).toThrow());
test('missing/mismatched expected digest and incomplete manifests refuse',()=>{
 expect(()=>validateResponsiveBuildProvenance(frozen,current,{expectedSourceSha256:'f'.repeat(64)})).toThrow();
 expect(()=>validateResponsiveBuildProvenance({...frozen,sourceBefore:null},current,{expectedSourceSha256:sha})).toThrow();
 expect(()=>validateResponsiveBuildProvenance(null,current,{expectedSourceSha256:sha})).toThrow();
});
