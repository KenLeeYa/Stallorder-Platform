import {afterEach,describe,expect,it} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,unlinkSync,utimesSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {assertRootAudit,auditPackageSet,inspectImports,parseClientReferenceManifest,prepareWebAudit,verifyWebArtifact,verifyRscOwnerMapping} from './web-release-dependency-audit.mjs';
const temporary=[];
afterEach(()=>{for(const root of temporary.splice(0))rmSync(root,{recursive:true,force:true});});
const audit={metadata:{vulnerabilities:{total:0}},vulnerabilities:{}};
const sbom={bomFormat:'CycloneDX',components:[{name:'safe',version:'1.0.0'}]};
function fixture(){
 const root=mkdtempSync(join(tmpdir(),'stallorder-web-audit-'));temporary.push(root);
 const write=(path,value)=>{mkdirSync(join(root,path,'..'),{recursive:true});writeFileSync(join(root,path),value);};
 write('package.json',JSON.stringify({dependencies:{safe:'1.0.0'}}));write('package-lock.json',JSON.stringify({packages:{'node_modules/safe':{version:'1.0.0'}}}));
 write('packages/contracts/package.json',JSON.stringify({name:'@stallorder/contracts',dependencies:{}}));write('src/page.ts',"import 'safe';");
 execFileSync('git',['init','--quiet'],{cwd:root});execFileSync('git',['add','.'],{cwd:root});execFileSync('git',['-c','user.name=Synthetic QA','-c','user.email=qa@example.invalid','commit','--quiet','-m','synthetic fixture'],{cwd:root});
 const baseline=prepareWebAudit(root);
 write('node_modules/safe/package.json',JSON.stringify({name:'safe',version:'1.0.0'}));write('node_modules/safe/index.js','module.exports=1;');
 write('.next/BUILD_ID','synthetic-build');utimesSync(join(root,'.next/BUILD_ID'),new Date(),new Date(Date.parse(baseline.preparedAt)+1000));
 write('.next/server/page.js',"require('safe');");write('.next/server/page.js.nft.json',JSON.stringify({version:1,files:['../../node_modules/safe/index.js']}));
 write('.next/server/app/page_client-reference-manifest.js','globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {}; globalThis.__RSC_MANIFEST["/page"] = {"clientModules":{}};');
 write('.next/server/server-reference-manifest.json',JSON.stringify({node:{},edge:{}}));
 return {root,write,baseline,verify:()=>verifyWebArtifact(root,baseline,audit,sbom)};
}
describe('Web artifact dependency scope',()=>{
 it('parses manifests as literal data without executing code',()=>{expect(parseClientReferenceManifest('globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {}; globalThis.__RSC_MANIFEST["/page"] = {"chunks":[]};')).toEqual({chunks:[]});expect(()=>parseClientReferenceManifest('globalThis.__RSC_MANIFEST = {}; globalThis.__RSC_MANIFEST["/page"] = fetch("https://evil.test");')).toThrow('NOT_LITERAL');});
 it('rejects absent client chunks referenced by manifests',()=>{const f=fixture();f.write('.next/server/app/page_client-reference-manifest.js','globalThis.__RSC_MANIFEST = globalThis.__RSC_MANIFEST || {}; globalThis.__RSC_MANIFEST["/page"] = {"chunks":["/_next/static/absent.js"]};');expect(f.verify).toThrow('MANIFEST_REFERENCE_INVALID');});
 it('keeps unreviewed server action maps failclosed',()=>{const f=fixture();f.write('.next/server/server-reference-manifest.json',JSON.stringify({node:{action:{workers:{unknown:1}}},edge:{}}));expect(f.verify).toThrow('SERVER_ACTION_CLOSURE_UNREVIEWED');});
 it('requires valid zero-vulnerability root audit, not a successful network request alone',()=>{assertRootAudit(audit);expect(()=>assertRootAudit({error:{code:'network'}})).toThrow('INVALID');expect(()=>assertRootAudit({metadata:{vulnerabilities:{total:1}},vulnerabilities:{vulnerable:{}}})).toThrow('VULNERABILITIES');});
 it('rejects native SBOM entries and packages absent from locked closure',()=>{expect(()=>auditPackageSet({...sbom,components:[{name:'expo',version:'57'}]},{packages:{}})).toThrow('NATIVE');expect(()=>auditPackageSet(sbom,{packages:{}})).toThrow('LOCK_MISMATCH');});
 it('identifies unknown dynamic loaders and literal native imports with the AST',()=>{expect(inspectImports("import(name);require(target);import 'expo';",'test.js')).toMatchObject({imports:['expo'],unknown:[{kind:'import'},{kind:'require'}]});});
 it('binds a synthetic fresh artifact to source, HEAD, lock and every trace',()=>{const f=fixture();expect(f.verify()).toMatchObject({status:'PASS',traces:1,tracedFiles:1,buildId:'synthetic-build',head:f.baseline.head,lockSha256:f.baseline.lockSha256});expect(f.verify().artifactSha256).toMatch(/^[a-f0-9]{64}$/);});
 it('rejects product-source drift after prepare',()=>{const f=fixture();f.write('src/page.ts','export const changed=true;');expect(f.verify).toThrow('WEB_SOURCE_CHANGED');});
 it('rejects reused builds even if the file timestamp is fresh',()=>{const f=fixture();f.baseline.oldBuildId='synthetic-build';expect(f.verify).toThrow('FRESH_BUILD');});
 it('rejects absent trace evidence',()=>{const f=fixture();unlinkSync(join(f.root,'.next/server/page.js.nft.json'));expect(f.verify).toThrow('ARTIFACT_EMPTY');});
 it('rejects missing traced files',()=>{const f=fixture();unlinkSync(join(f.root,'node_modules/safe/index.js'));expect(f.verify).toThrow('TRACE_FILE_MISSING');});
 it('rejects trace escape outside the checkout',()=>{const f=fixture();const outside=join(f.root,'..','escape-web-audit.txt');writeFileSync(outside,'synthetic');try{f.write('.next/server/page.js.nft.json',JSON.stringify({version:1,files:['../../../escape-web-audit.txt']}));expect(f.verify).toThrow('ESCAPES_ROOT');}finally{unlinkSync(outside);}});
 it('rejects a compiled dependency outside the audited root graph',()=>{const f=fixture();f.write('node_modules/safe/package.json',JSON.stringify({name:'node-forge',version:'1.4.0'}));expect(f.verify()).toMatchObject({status:'INCOMPLETE',problems:[{code:'TRACE_PACKAGE_OUTSIDE_AUDITED_CLOSURE'}]});});
 it('attributes vendored metadata to its actual locked package boundary',()=>{const f=fixture();f.write('node_modules/safe/compiled/vendor/package.json',JSON.stringify({name:'vendored-internal',version:'1'}));f.write('node_modules/safe/compiled/vendor/index.js','synthetic');f.write('.next/server/page.js.nft.json',JSON.stringify({version:1,files:['../../node_modules/safe/compiled/vendor/index.js']}));expect(f.verify()).toMatchObject({status:'PASS'});});
 it('never approves unknown compiled loading even in a framework-named runtime',()=>{const f=fixture();f.write('.next/server/[turbopack]_runtime.js','require(resolved);');expect(f.verify()).toMatchObject({status:'INCOMPLETE',problems:[{code:'UNKNOWN_COMPILED_IMPORT'}]});});
 it('rejects bundled literal native imports',()=>{const f=fixture();f.write('.next/server/page.js',"require('expo-router');");expect(f.verify()).toMatchObject({status:'INCOMPLETE',problems:[{code:'NATIVE_COMPILED_IMPORT'}]});});
 it('requires shared contracts dependencies to be explicitly audited',()=>{const f=fixture();f.write('packages/contracts/package.json',JSON.stringify({name:'@stallorder/contracts',dependencies:{'node-forge':'1.4.0'}}));f.baseline=prepareWebAudit(f.root);utimesSync(join(f.root,'.next/BUILD_ID'),new Date(),new Date(Date.parse(f.baseline.preparedAt)+1000));f.baseline.oldBuildId=null;expect(()=>verifyWebArtifact(f.root,f.baseline,audit,sbom)).toThrow('CONTRACTS_DEPENDENCY');});
});

describe('RSC route owner closure',()=>{
 function rsc(){const f=fixture();f.write('.next/server/app/page.js','module.exports={};');f.write('.next/server/chunks/owned.js','module.exports=[7,8,e=>{}];');f.write('.next/server/app/page.js.nft.json',JSON.stringify({files:['../chunks/owned.js']}));const manifest={ssrModuleMapping:{client:{'*':{id:8,chunks:['server/chunks/owned.js']}}}};return{...f,manifest,path:join(f.root,'.next/server/app/page_client-reference-manifest.js')};}
 it('binds a server module ID to a factory in the owning route trace',()=>{const f=rsc();expect(verifyRscOwnerMapping(f.root,f.path,f.manifest)).toEqual({modules:1});});
 it('rejects a real chunk outside the specific route trace',()=>{const f=rsc();f.write('.next/server/app/page.js.nft.json',JSON.stringify({files:[]}));expect(()=>verifyRscOwnerMapping(f.root,f.path,f.manifest)).toThrow('OWNER_CHUNK_UNTRACED');});
 it('rejects an undefined module ID even when its chunk is traced',()=>{const f=rsc();f.manifest.ssrModuleMapping.client['*'].id=9;expect(()=>verifyRscOwnerMapping(f.root,f.path,f.manifest)).toThrow('MODULE_UNDEFINED');});
 it('rejects escaping and nonliteral chunk data',()=>{const f=rsc();f.manifest.ssrModuleMapping.client['*'].chunks=['server/../../outside.js'];expect(()=>verifyRscOwnerMapping(f.root,f.path,f.manifest)).toThrow('OWNER_CHUNK_UNTRACED');f.manifest.ssrModuleMapping.client['*'].chunks=[{}];expect(()=>verifyRscOwnerMapping(f.root,f.path,f.manifest)).toThrow('CHUNK_INVALID');});
});
describe('resident RSC module closure',()=>{
 it('requires the empty-chunks module to exist in literal owner bootstrap chunks',()=>{const f=fixture();f.write('.next/server/chunks/[turbopack]_runtime.js','module.exports=()=>({});');f.write('.next/server/app/page.js','var R=require("../chunks/[turbopack]_runtime.js")("server/app/page.js"); R.c("server/chunks/owned.js");');f.write('.next/server/chunks/owned.js','module.exports=[8,e=>{}];');f.write('.next/server/app/page.js.nft.json',JSON.stringify({files:['../chunks/owned.js','../chunks/[turbopack]_runtime.js']}));const m={rscModuleMapping:{client:{'*':{id:8,chunks:[]}}}};const p=join(f.root,'.next/server/app/page_client-reference-manifest.js');expect(verifyRscOwnerMapping(f.root,p,m)).toEqual({modules:1});f.write('.next/server/app/page.js','var R=require("../chunks/[turbopack]_runtime.js")("server/app/page.js"); R.c(userInput);');expect(()=>verifyRscOwnerMapping(f.root,p,m)).toThrow('OWNER_NONLITERAL_CHUNK');});
});
describe('RSC registration is executable top-level only',()=>{
 for(const source of ['if(false){module.exports=[8,e=>{}];}','function hidden(){module.exports=[8,e=>{}];}'])it('rejects unreachable or nested registration: '+source,()=>{const f=fixture();f.write('.next/server/app/page.js','module.exports={};');f.write('.next/server/chunks/owned.js',source);f.write('.next/server/app/page.js.nft.json',JSON.stringify({files:['../chunks/owned.js']}));expect(()=>verifyRscOwnerMapping(f.root,join(f.root,'.next/server/app/page_client-reference-manifest.js'),{ssrModuleMapping:{client:{'*':{id:8,chunks:['server/chunks/owned.js']}}}})).toThrow('MODULE_UNDEFINED');});
 it('rejects unbound owner bootstrap R',()=>{const f=fixture();f.write('.next/server/app/page.js','R.c("server/chunks/owned.js");');f.write('.next/server/app/page.js.nft.json',JSON.stringify({files:[]}));expect(()=>verifyRscOwnerMapping(f.root,join(f.root,'.next/server/app/page_client-reference-manifest.js'),{rscModuleMapping:{client:{'*':{id:8,chunks:[]}}}})).toThrow('RUNTIME_BINDING');});
});