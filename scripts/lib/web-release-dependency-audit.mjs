import {createHash} from 'node:crypto';
import {execFileSync,spawnSync} from 'node:child_process';
import {existsSync,readFileSync,readdirSync,realpathSync,statSync,mkdtempSync,writeFileSync,rmSync} from 'node:fs';
import {dirname,join,relative,resolve,sep} from 'node:path';
import {builtinModules} from 'node:module';
import {tmpdir} from 'node:os';
import ts from 'typescript';
import {verifyWebInstallScope} from '../verify-web-install-scope.mjs';

const hash=value=>createHash('sha256').update(value).digest('hex');
const nativePackage=name=>/^(?:expo(?:$|-)|@expo\/|react-native(?:$|-)|@react-native\/|node-forge$|decode-uri-component$|query-string$)/.test(name);
const inside=(root,path)=>path===root||path.startsWith(root+sep);
function files(root){return existsSync(root)?readdirSync(root,{withFileTypes:true}).flatMap(e=>e.isDirectory()?files(join(root,e.name)):[join(root,e.name)]):[];}
const json=path=>JSON.parse(readFileSync(path,'utf8'));
function reject(code){throw new Error(code);}

export function inspectImports(source,path){
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true),imports=[],unknown=[];
 const visit=node=>{
  if(ts.isImportDeclaration(node)&&!node.importClause?.isTypeOnly)imports.push(node.moduleSpecifier.text);
  if(ts.isExportDeclaration(node)&&!node.isTypeOnly&&node.moduleSpecifier)imports.push(node.moduleSpecifier.text);
  if(ts.isCallExpression(node)&&(node.expression.kind===ts.SyntaxKind.ImportKeyword||node.expression.getText(ast)==='require')){
   if(node.arguments[0]&&ts.isStringLiteralLike(node.arguments[0]))imports.push(node.arguments[0].text);
   else unknown.push({line:ast.getLineAndCharacterOfPosition(node.getStart(ast)).line+1,kind:node.expression.kind===ts.SyntaxKind.ImportKeyword?'import':'require'});
  }
  ts.forEachChild(node,visit);
 };visit(ast);return {imports,unknown,parseErrors:ast.parseDiagnostics.length};
}
function packageName(specifier){return specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];}
export function assertRootAudit(audit){
 if(audit.error||!audit.metadata?.vulnerabilities||!audit.vulnerabilities)reject('WEB_ROOT_AUDIT_INVALID');
 if(Object.keys(audit.vulnerabilities).length||audit.metadata.vulnerabilities.total!==0)reject('WEB_ROOT_AUDIT_VULNERABILITIES');
}
export function parseClientReferenceManifest(source,path='client-reference-manifest.js'){
 const ast=ts.createSourceFile(path,source,ts.ScriptTarget.Latest,true);
 if(ast.parseDiagnostics.length||ast.statements.length!==2)reject('WEB_MANIFEST_NOT_LITERAL');
 const init=ast.statements[0],assignment=ast.statements[1];
 if(!ts.isExpressionStatement(init)||init.expression.getText(ast).replace(/\s/g,'')!=='globalThis.__RSC_MANIFEST=globalThis.__RSC_MANIFEST||{}')reject('WEB_MANIFEST_NOT_LITERAL');
 if(!ts.isExpressionStatement(assignment)||!ts.isBinaryExpression(assignment.expression)||assignment.expression.operatorToken.kind!==ts.SyntaxKind.EqualsToken)reject('WEB_MANIFEST_NOT_LITERAL');
 const node=assignment.expression;
 if(!ts.isElementAccessExpression(node.left)||node.left.expression.getText(ast)!=='globalThis.__RSC_MANIFEST'||!ts.isStringLiteral(node.left.argumentExpression)||!ts.isObjectLiteralExpression(node.right))reject('WEB_MANIFEST_NOT_LITERAL');
 try{return JSON.parse(node.right.getText(ast));}catch{reject('WEB_MANIFEST_NOT_LITERAL');}
}
export function verifyRscOwnerMapping(root,manifestPath,manifest,cache=new Map()){
 const ownerPath=manifestPath.replace(/_client-reference-manifest\.js$/,'.js');
 const tracePath=ownerPath+'.nft.json';
 const mappings=['ssrModuleMapping','edgeSSRModuleMapping','rscModuleMapping','edgeRscModuleMapping'];
 if(!mappings.some(key=>Object.keys(manifest[key]??{}).length))return {modules:0};
 if(!existsSync(ownerPath)||!existsSync(tracePath))reject('WEB_RSC_OWNER_MISSING');
 const ownerTrace=new Set(json(tracePath).files.map(file=>realpathSync(resolve(dirname(tracePath),file))));
 const ownerAst=ts.createSourceFile(ownerPath,readFileSync(ownerPath,'utf8'),ts.ScriptTarget.Latest,true),initialChunks=[];
 let bound=false;
 for(const statement of ownerAst.statements){
  if(ts.isVariableStatement(statement))for(const declaration of statement.declarationList.declarations){
   const call=declaration.initializer;
   if(declaration.name.getText(ownerAst)!=='R')continue;
   if(bound||!call||!ts.isCallExpression(call)||call.arguments.length!==1||!ts.isStringLiteral(call.arguments[0])||call.arguments[0].text!==relative(join(root,'.next'),ownerPath).replaceAll('\\','/'))reject('WEB_RSC_OWNER_RUNTIME_BINDING');
   const loader=call.expression;
   if(!ts.isCallExpression(loader)||loader.expression.getText(ownerAst)!=='require'||loader.arguments.length!==1||!ts.isStringLiteral(loader.arguments[0]))reject('WEB_RSC_OWNER_RUNTIME_BINDING');
   const runtime=resolve(dirname(ownerPath),loader.arguments[0].text);
   if(!['chunks/[turbopack]_runtime.js','chunks/ssr/[turbopack]_runtime.js'].includes(relative(join(root,'.next/server'),runtime).replaceAll('\\','/'))||!existsSync(runtime)||!ownerTrace.has(realpathSync(runtime)))reject('WEB_RSC_OWNER_RUNTIME_BINDING');
   bound=true;
  }
  const node=ts.isExpressionStatement(statement)?statement.expression:null;
  if(node&&ts.isCallExpression(node)&&ts.isPropertyAccessExpression(node.expression)&&node.expression.expression.getText(ownerAst)==='R'&&node.expression.name.text==='c'){
   if(!bound)reject('WEB_RSC_OWNER_RUNTIME_BINDING');
   if(node.arguments.length!==1||!ts.isStringLiteral(node.arguments[0]))reject('WEB_RSC_OWNER_NONLITERAL_CHUNK');
   initialChunks.push(node.arguments[0].text);
  }
 }let modules=0;
 for(const key of mappings)for(const exports of Object.values(manifest[key]??{}))for(const entry of Object.values(exports)){
  if(!entry||!Number.isSafeInteger(entry.id)||!Array.isArray(entry.chunks))reject('WEB_RSC_MODULE_INVALID');
  let defined=false;
  const chunks=entry.chunks.length?entry.chunks:initialChunks;
  if(!chunks.length)reject('WEB_RSC_MODULE_INVALID');
  for(const chunk of chunks){
   if(typeof chunk!=='string'||!chunk.startsWith('server/')||!chunk.endsWith('.js'))reject('WEB_RSC_CHUNK_INVALID');
   const path=resolve(root,'.next',chunk);
   if(!inside(resolve(root,'.next/server'),path)||!existsSync(path)||!ownerTrace.has(realpathSync(path)))reject('WEB_RSC_OWNER_CHUNK_UNTRACED');
   if(!cache.has(path)){
    const ast=ts.createSourceFile(path,readFileSync(path,'utf8'),ts.ScriptTarget.Latest,true),ids=new Set();
    if(ast.parseDiagnostics.length)reject('WEB_RSC_CHUNK_PARSE');
    for(const statement of ast.statements){
     const node=ts.isExpressionStatement(statement)?statement.expression:null;
     if(!node)continue;
     if(ts.isBinaryExpression(node)&&node.operatorToken.kind===ts.SyntaxKind.EqualsToken&&node.left.getText(ast)==='module.exports'&&ts.isArrayLiteralExpression(node.right)){
      let pending=[];
      for(const item of node.right.elements){
       if(ts.isNumericLiteral(item))pending.push(Number(item.text));
       else if(ts.isArrowFunction(item)||ts.isFunctionExpression(item)){pending.forEach(id=>ids.add(id));pending=[];}
       else pending=[];
      }
     }
    }cache.set(path,ids);
   }
   if(cache.get(path).has(entry.id))defined=true;
  }
  if(!defined)reject('WEB_RSC_MODULE_UNDEFINED');
  modules++;
 }
 return {modules};
}
export function verifyManifestReferences(root,nextFiles,traced){
 const manifests=nextFiles.filter(p=>p.endsWith('_client-reference-manifest.js'));
 if(!manifests.length)reject('WEB_CLIENT_MANIFEST_MISSING');
 const references=new Set();
 const walk=value=>{
  if(typeof value==='string'){
   if(value.includes('apps/mobile/')||value.includes('node_modules/expo')||value.includes('node_modules/@expo/'))reject('WEB_MANIFEST_NATIVE_REFERENCE');
   if(value.startsWith('server/')||value.startsWith('/_next/static/')){
    const target=resolve(root,'.next',value.replace(/^\/_next\//,''));
    if(!inside(resolve(root,'.next'),target)||!existsSync(target))reject('WEB_MANIFEST_REFERENCE_INVALID');
    if(value.startsWith('server/')&&!traced.has(realpathSync(target)))reject('WEB_MANIFEST_SERVER_REFERENCE_UNTRACED');
    references.add(target);
   }
  }else if(Array.isArray(value))value.forEach(walk);
  else if(value&&typeof value==='object')Object.values(value).forEach(walk);
 };
 let rscModules=0;const moduleCache=new Map();
 for(const path of manifests){const manifest=parseClientReferenceManifest(readFileSync(path,'utf8'),path);walk(manifest);rscModules+=verifyRscOwnerMapping(root,path,manifest,moduleCache).modules;}
 const actionPath=join(root,'.next/server/server-reference-manifest.json');
 if(!existsSync(actionPath))reject('WEB_SERVER_MANIFEST_MISSING');
 const actions=json(actionPath);
 if(!actions.node||!actions.edge)reject('WEB_SERVER_MANIFEST_INVALID');
 // Nonempty action maps need an independently reviewed module-ID/worker binding.
 if(Object.keys(actions.node).length||Object.keys(actions.edge).length)reject('WEB_SERVER_ACTION_CLOSURE_UNREVIEWED');
 return {clientManifests:manifests.length,references:references.size,serverActions:0,rscModules};
}
export function auditPackageSet(sbom,lock){
 if(sbom.bomFormat!=='CycloneDX'||!Array.isArray(sbom.components)||!sbom.components.length)reject('WEB_SBOM_INVALID');
 const set=new Set();
 for(const rawComponent of sbom.components){
  const component={...rawComponent,name:rawComponent.group?`${rawComponent.group}/${rawComponent.name}`:rawComponent.name};
  if(!component.name||!component.version||nativePackage(component.name))reject('WEB_SBOM_NATIVE_OR_INVALID');
  if(!Object.values(lock.packages??{}).some(p=>!p.link&&p.version===component.version&&(p.name===component.name||p.resolved?.includes(`/${component.name.split('/').at(-1)}-/`)))){
   const suffix=`node_modules/${component.name}`;
   if(!Object.entries(lock.packages??{}).some(([path,p])=>(path===suffix||path.endsWith('/'+suffix))&&p.version===component.version))reject('WEB_SBOM_LOCK_MISMATCH');
  }
  set.add(`${component.name}@${component.version}`);
 }
 return set;
}
export function sourceSnapshot(root){
 const paths=['src','packages/contracts','public','prisma','supabase/functions/_shared'].flatMap(p=>files(join(root,p)))
  .concat(['package.json','package-lock.json','next.config.ts','tsconfig.json','postcss.config.mjs','vercel.json','scripts/lib/web-release-dependency-audit.mjs','scripts/web-release-dependency-audit.mjs','scripts/verify-web-install-scope.mjs','.github/workflows/web-install-scope.yml','scripts/verify-web-release-scope.mjs','scripts/verify-web-release-plan.mjs','.github/workflows/ci.yml','.github/workflows/production-readiness.yml','.github/workflows/production-application-release.yml'].map(p=>join(root,p)))
  .filter(p=>existsSync(p)).sort();
 if(!paths.length)reject('WEB_SOURCE_EMPTY');
 const digest=hash(paths.map(p=>`${relative(root,p).replaceAll('\\','/')}\0${hash(readFileSync(p))}`).join('\n'));
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 return {head:git('rev-parse','HEAD'),tree:git('rev-parse','HEAD^{tree}'),sourceSha256:digest,lockSha256:hash(readFileSync(join(root,'package-lock.json')))};
}
export function prepareWebAudit(root){return {version:1,scope:'WEB_PRODUCTION_ROOT_AND_BUILD_DEPENDENCIES',preparedAt:new Date().toISOString(),...sourceSnapshot(root),oldBuildId:existsSync(join(root,'.next/BUILD_ID'))?readFileSync(join(root,'.next/BUILD_ID'),'utf8').trim():null};}


/** Exact generated Prisma output is attributed to its locked audited generator, never a hidden-package wildcard. */
export function verifyGeneratedPrisma(root,packages){
 const generated=join(root,'node_modules/.prisma/client'),lock=json(join(root,'package-lock.json'));
 const generatedReal=realpathSync(generated);
 if(generatedReal!==resolve(realpathSync(root),'node_modules/.prisma/client'))reject('WEB_PRISMA_GENERATED_PATH_INVALID');
 const owners={};
 for(const name of ['prisma','@prisma/client']){
  const path=join(root,'node_modules',name),pkg=json(join(path,'package.json'));
  if(realpathSync(path)!==resolve(realpathSync(root),'node_modules',name)||pkg.name!==name||pkg.version!==lock.packages?.[`node_modules/${name}`]?.version||!packages.has(`${name}@${pkg.version}`))reject('WEB_PRISMA_GENERATOR_UNAUDITED');
  owners[name]=pkg;
 }
 if(owners.prisma.version!==owners['@prisma/client'].version)reject('WEB_PRISMA_GENERATOR_VERSION_MISMATCH');
 const pkg=json(join(generated,'package.json')),schema=readFileSync(join(generated,'schema.prisma'),'utf8');
 if(pkg.version!==owners.prisma.version||pkg.name!==`prisma-client-${hash(schema)}`)reject('WEB_PRISMA_GENERATED_IDENTITY_INVALID');
 const cli=resolve(root,'node_modules/prisma',typeof owners.prisma.bin==='string'?owners.prisma.bin:owners.prisma.bin?.prisma??'');
 if(!inside(realpathSync(join(root,'node_modules/prisma')),realpathSync(cli))||!statSync(cli).isFile())reject('WEB_PRISMA_FORMATTER_INVALID');
 const generator=join(root,'node_modules/@prisma/client/generator-build/index.js'),wasm=join(root,'node_modules/prisma/build/prisma_schema_build_bg.wasm');
 for(const [file,owner] of [[generator,'@prisma/client'],[wasm,'prisma']])if(!inside(realpathSync(join(root,'node_modules',owner)),realpathSync(file))||!statSync(file).isFile())reject('WEB_PRISMA_PRODUCER_FILE_INVALID');
 const temporary=mkdtempSync(join(tmpdir(),'stallorder-schema-proof-'));
 try{
  const copy=join(temporary,'schema.prisma');writeFileSync(copy,readFileSync(join(root,'prisma/schema.prisma')));
  try{execFileSync(process.execPath,[cli,'format','--schema',copy],{cwd:temporary,encoding:'utf8',stdio:'pipe',timeout:30000,env:{SystemRoot:process.env.SystemRoot??'',PATH:process.env.PATH??'',TEMP:tmpdir(),TMP:tmpdir(),CHECKPOINT_DISABLE:'1',PRISMA_HIDE_UPDATE_MESSAGE:'1'}});}catch{reject('WEB_PRISMA_FORMATTER_FAILED');}
  if(readFileSync(copy,'utf8')!==schema)reject('WEB_PRISMA_SOURCE_SCHEMA_MISMATCH');
 }finally{rmSync(temporary,{recursive:true,force:true,maxRetries:10,retryDelay:100});}
 const ast=ts.createSourceFile('index.js',readFileSync(join(generated,'index.js'),'utf8'),ts.ScriptTarget.Latest,true);
 if(ast.parseDiagnostics.length)reject('WEB_PRISMA_CONFIG_INVALID');
 const configs=ast.statements.filter(ts.isVariableStatement).flatMap(statement=>[...statement.declarationList.declarations]).filter(declaration=>declaration.name.getText(ast)==='config');
 if(configs.length!==1||!configs[0].initializer||!ts.isObjectLiteralExpression(configs[0].initializer))reject('WEB_PRISMA_CONFIG_INVALID');
 const values=new Map(),keys=new Set();
 for(const property of configs[0].initializer.properties){
  if(!ts.isPropertyAssignment(property)||ts.isComputedPropertyName(property.name))reject('WEB_PRISMA_CONFIG_INVALID');
  const key=ts.isStringLiteralLike(property.name)?property.name.text:property.name.getText(ast);
  if(keys.has(key))reject('WEB_PRISMA_CONFIG_INVALID');keys.add(key);
  if(['inlineSchema','clientVersion'].includes(key)&&!ts.isStringLiteralLike(property.initializer))reject('WEB_PRISMA_CONFIG_INVALID');
  if(ts.isStringLiteralLike(property.initializer))values.set(key,property.initializer.text);
 }
 if(values.get('inlineSchema')!==schema||values.get('clientVersion')!==pkg.version)reject('WEB_PRISMA_CONFIG_INVALID');
 const seen=new Set(),generatedFiles=[];
 const walk=directory=>{
  const real=realpathSync(directory);
  if(!inside(generatedReal,real)||seen.has(real))reject('WEB_PRISMA_GENERATED_PATH_INVALID');seen.add(real);
  for(const name of readdirSync(real)){
   const path=join(real,name),target=realpathSync(path);
   if(!inside(generatedReal,target))reject('WEB_PRISMA_GENERATED_PATH_INVALID');
   if(name==='node_modules'||(name==='package.json'&&target!==join(generatedReal,'package.json')))reject('WEB_PRISMA_NESTED_PACKAGE_FORBIDDEN');
   if(statSync(target).isDirectory()){walk(target);continue;}
   if(!statSync(target).isFile())reject('WEB_PRISMA_GENERATED_PATH_INVALID');generatedFiles.push(target);
   if(/\.[cm]?js$/.test(name)){
    const scan=inspectImports(readFileSync(target,'utf8'),target);
    if(scan.parseErrors||scan.unknown.length)reject('WEB_PRISMA_GENERATED_IMPORT_UNPROVEN');
    for(const specifier of scan.imports){
     if(nativePackage(packageName(specifier)))reject('WEB_PRISMA_NATIVE_GENERATED_IMPORT');
     if(specifier.startsWith('.')){if(!inside(generatedReal,resolve(dirname(target),specifier)))reject('WEB_PRISMA_GENERATED_PATH_INVALID');}
     else if(specifier.startsWith('#')){if(!Object.hasOwn(pkg.imports??{},specifier))reject('WEB_PRISMA_GENERATED_IMPORT_UNPROVEN');}
     else if(!specifier.startsWith('node:')&&!builtinModules.includes(specifier)&&![...packages].some(p=>p.startsWith(packageName(specifier)+'@')))reject('WEB_PRISMA_GENERATED_IMPORT_UNPROVEN');
    }
   }
  }
 };
 const aliases=value=>{
  if(typeof value==='string'){const path=resolve(generatedReal,value);if(!value.startsWith('./')||!inside(generatedReal,path)||!existsSync(path)||!inside(generatedReal,realpathSync(path)))reject('WEB_PRISMA_GENERATED_IMPORT_UNPROVEN');}
  else if(value&&typeof value==='object'&&!Array.isArray(value))Object.values(value).forEach(aliases);
  else reject('WEB_PRISMA_GENERATED_IMPORT_UNPROVEN');
 };
 Object.values(pkg.imports??{}).forEach(aliases);walk(generatedReal);
 return {path:'node_modules/.prisma/client',name:pkg.name,version:pkg.version,schemaSha256:hash(schema),formatterSha256:hash(readFileSync(cli)),formatterWasmSha256:hash(readFileSync(wasm)),generatorSha256:hash(readFileSync(generator)),sourceSchemaSha256:hash(readFileSync(join(root,'prisma/schema.prisma'))),generatedFiles:generatedFiles.length,generatedFilesSha256:hash(generatedFiles.sort().map(path=>`${relative(generatedReal,path)}\0${hash(readFileSync(path))}`).join('\n'))};
}

export function verifyWebArtifact(root,baseline,audit,sbom){
 assertRootAudit(audit);
 if(baseline.version!==1||baseline.scope!=='WEB_PRODUCTION_ROOT_AND_BUILD_DEPENDENCIES'||!Number.isFinite(Date.parse(baseline.preparedAt)))reject('WEB_PREBUILD_RECEIPT_INVALID');
 const current=sourceSnapshot(root);
 for(const key of ['head','tree','sourceSha256','lockSha256'])if(current[key]!==baseline[key])reject('WEB_SOURCE_CHANGED_'+key);
 const buildPath=join(root,'.next/BUILD_ID');
 if(!existsSync(buildPath)||statSync(buildPath).mtimeMs<Date.parse(baseline.preparedAt))reject('WEB_FRESH_BUILD_REQUIRED');
 const buildId=readFileSync(buildPath,'utf8').trim();if(!buildId||buildId===baseline.oldBuildId)reject('WEB_FRESH_BUILD_REQUIRED');
 const lock=json(join(root,'package-lock.json')),packages=auditPackageSet(sbom,lock);
 const contract=json(join(root,'packages/contracts/package.json'));
 if(contract.name!=='@stallorder/contracts'||contract.scripts||contract.optionalDependencies||contract.peerDependencies)reject('WEB_CONTRACTS_SCOPE_UNPROVEN');
 for(const [name,version]of Object.entries(contract.dependencies??{}))if(!packages.has(`${name}@${version}`))reject('WEB_CONTRACTS_DEPENDENCY_UNAUDITED');
 const problems=[];
 const sourceFiles=['src','packages/contracts'].flatMap(p=>files(join(root,p))).filter(p=>/\.[cm]?[jt]sx?$/.test(p)&&! /\.(?:test|spec)\./.test(p)&&!relative(root,p).replaceAll('\\','/').startsWith('src/test/'));
 const scannedSources=new Set();
 for(const path of sourceFiles){
  const real=realpathSync(path);if(scannedSources.has(real))continue;scannedSources.add(real);
  const scan=inspectImports(readFileSync(path,'utf8'),path);
  if(scan.parseErrors)problems.push({path:relative(root,path),code:'SOURCE_PARSE_FAILED'});
  if(scan.unknown.length)problems.push({path:relative(root,path),code:'UNKNOWN_SOURCE_IMPORT',calls:scan.unknown});
  for(const specifier of scan.imports){
   if(specifier.includes('apps/mobile')||nativePackage(packageName(specifier)))problems.push({path:relative(root,path),code:'NATIVE_SOURCE_IMPORT'});
   if(specifier.startsWith('.')){
    const target=resolve(dirname(path),specifier);
    if(!inside(root,target)||relative(root,target).replaceAll('\\','/').startsWith('apps/mobile/'))problems.push({path:relative(root,path),code:'SOURCE_IMPORT_ESCAPES_SCOPE'});
    else{
     // Deno-only helpers are not Web roots; scan them only when reached by a Web import.
     const resolved=ts.resolveModuleName(specifier,path,{moduleResolution:ts.ModuleResolutionKind.Bundler,module:ts.ModuleKind.ESNext,allowImportingTsExtensions:true},ts.sys).resolvedModule?.resolvedFileName;
     if(resolved&&/\.[cm]?[jt]sx?$/.test(resolved)){
      const resolvedReal=realpathSync(resolved);
      if(!inside(realpathSync(root),resolvedReal))problems.push({path:relative(root,path),code:'SOURCE_IMPORT_ESCAPES_SCOPE'});
      else if(!scannedSources.has(resolvedReal))sourceFiles.push(resolved);
     }
    }
   }else if(!specifier.startsWith('@/')&&!specifier.startsWith('node:')&&!builtinModules.includes(specifier)&&packageName(specifier)!=='@stallorder/contracts'){
    if(![...packages].some(p=>p.startsWith(packageName(specifier)+'@')))problems.push({path:relative(root,path),code:'SOURCE_PACKAGE_OUTSIDE_AUDITED_CLOSURE'});
   }

  }
 }
 const nextFiles=files(join(root,'.next/server')).concat(files(join(root,'.next/static')));
 const traces=files(join(root,'.next')).filter(p=>p.endsWith('.nft.json'));
 if(!traces.length||!nextFiles.length)reject('WEB_ARTIFACT_EMPTY');
 const realRoot=realpathSync(root),traced=new Set();let generatedPrisma=null;
 const prismaRoot=resolve(realRoot,'node_modules/.prisma/client');
 for(const path of traces){
  const trace=json(path);if(trace.version!==1||!Array.isArray(trace.files))reject('WEB_TRACE_INVALID');
  for(const entry of trace.files){
   if(typeof entry!=='string'||!entry)reject('WEB_TRACE_INVALID');
   const target=resolve(dirname(path),entry);if(!existsSync(target))reject('WEB_TRACE_FILE_MISSING');
   const realTarget=realpathSync(target);
   if(inside(prismaRoot,target)&&!inside(prismaRoot,realTarget))reject('WEB_PRISMA_GENERATED_PATH_INVALID');
   if(!inside(realRoot,realTarget))reject('WEB_TRACE_ESCAPES_ROOT');
   let targets=[realTarget];
   if(statSync(realTarget).isDirectory()){
    const directoryRel=relative(realRoot,realTarget).replaceAll('\\','/'),segments=directoryRel.split('/'),boundary=segments.lastIndexOf('node_modules');
    const isPackageRoot=boundary>=0&&segments.length===boundary+(segments[boundary+1]?.startsWith('@')?3:2);
    const isContract=realTarget===realpathSync(join(root,'packages/contracts'));
    const identity=existsSync(join(realTarget,'package.json'))?json(join(realTarget,'package.json')):null;
    const isGenerated=realTarget===prismaRoot;
    if(isGenerated)generatedPrisma??=verifyGeneratedPrisma(root,packages);
    if(!isGenerated&&((!isPackageRoot&&!isContract)||!identity?.name||nativePackage(identity.name)||!packages.has(`${identity.name}@${identity.version}`)||(isContract&&identity.name!==contract.name)))reject('WEB_TRACE_DIRECTORY_SCOPE_UNPROVEN');
    const visited=new Set();
    const expand=directory=>{
     const actual=realpathSync(directory);
     if(!inside(realRoot,actual))reject('WEB_TRACE_ESCAPES_ROOT');
     if(!inside(realTarget,actual))reject('WEB_TRACE_DIRECTORY_ESCAPES_WORKSPACE');
     if(visited.has(actual))reject('WEB_TRACE_DIRECTORY_CYCLE');
     visited.add(actual);
     return readdirSync(actual).flatMap(name=>{
      const path=join(actual,name),resolved=realpathSync(path);
      if(!inside(realRoot,resolved))reject('WEB_TRACE_ESCAPES_ROOT');
      if(!inside(realTarget,resolved))reject('WEB_TRACE_DIRECTORY_ESCAPES_WORKSPACE');
      if(statSync(resolved).isDirectory())return expand(resolved);
      if(!statSync(resolved).isFile())reject('WEB_TRACE_NON_FILE');
      return [resolved];
     });
    };
    targets=expand(realTarget);
    if(!targets.length)reject('WEB_TRACE_DIRECTORY_EMPTY');
   }
   for(const real of targets){
   if(!statSync(real).isFile())reject('WEB_TRACE_NON_FILE');
   const rel=relative(realRoot,real).replaceAll('\\','/');
   if(rel.startsWith('apps/mobile/'))reject('WEB_TRACE_NATIVE_WORKSPACE');
   if(inside(prismaRoot,real)){generatedPrisma??=verifyGeneratedPrisma(root,packages);}
   else if(rel.includes('node_modules/')){
    const segments=rel.split('/'),boundary=segments.lastIndexOf('node_modules');
    const packageEnd=boundary+(segments[boundary+1]?.startsWith('@')?3:2);
    const packageRoot=join(realRoot,...segments.slice(0,packageEnd));
    const manifest=existsSync(join(packageRoot,'package.json'))?json(join(packageRoot,'package.json')):null;
    if(!manifest?.name||nativePackage(manifest.name)||!packages.has(`${manifest.name}@${manifest.version}`))problems.push({path:rel,code:'TRACE_PACKAGE_OUTSIDE_AUDITED_CLOSURE'});
   }
   traced.add(real);
   }
  }
 }
 for(const path of nextFiles.filter(p=>p.endsWith('.js'))){
  const scan=inspectImports(readFileSync(path,'utf8'),path);
  if(scan.parseErrors)problems.push({path:relative(root,path),code:'COMPILED_PARSE_FAILED'});
  if(scan.unknown.length)problems.push({path:relative(root,path),code:'UNKNOWN_COMPILED_IMPORT',calls:scan.unknown});
  if(scan.imports.some(s=>s.includes('apps/mobile')||nativePackage(packageName(s))))problems.push({path:relative(root,path),code:'NATIVE_COMPILED_IMPORT'});
 }
 const manifestClosure=verifyManifestReferences(root,nextFiles,traced);
 const artifactInputs=[...new Set([...nextFiles,...traces,...traced,buildPath])].sort().map(p=>`${relative(root,p).replaceAll('\\','/')}\0${hash(readFileSync(p))}`);
 const receipt={version:1,scope:baseline.scope,...current,buildId,traces:traces.length,tracedFiles:traced.size,artifactSha256:hash(artifactInputs.join('\n')),rootAudit:'PASS',manifestClosure,generatedPrisma,sourceScope:{roots:['src','packages/contracts'],scannedFiles:scannedSources.size,edgeFunctions:'NOT_VERIFIED_DENO_QA_REQUIRED'},status:problems.length?'INCOMPLETE':'PASS',problems};
 return receipt;
}
export function npmJson(root,args){
 const result=process.platform==='win32'?spawnSync(process.env.ComSpec??'cmd.exe',['/d','/s','/c',`npm ${args.join(' ')}`],{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024}):spawnSync('npm',args,{cwd:root,encoding:'utf8',maxBuffer:16*1024*1024});
 let value;try{value=JSON.parse(result.stdout);}catch{reject('NPM_AUDIT_OUTPUT_INVALID');}
 return {status:result.status,value};
}

/** A physical known-Native-chain exclusion proof; generic loader safety stays separate. */
export function verifyKnownNativeExclusion(root,baseline,audit,sbom){
 const installed=verifyWebInstallScope(root,sbom);
 const general=verifyWebArtifact(root,baseline,audit,sbom);
 const genericLoaders=general.problems.filter(problem=>problem.code==='UNKNOWN_COMPILED_IMPORT');
 const problems=general.problems.filter(problem=>problem.code!=='UNKNOWN_COMPILED_IMPORT');
 return {...general,scope:'WEB_KNOWN_NATIVE_DEPENDENCY_EXCLUSION',status:problems.length?'INCOMPLETE':'PASS',problems,installation:installed,auditSha256:hash(JSON.stringify(audit)),sbomSha256:hash(JSON.stringify(sbom)),generalArtifactAnalysis:{status:general.status,unreviewedGenericLoaders:genericLoaders},runtimeLoaderSafety:'NOT_PROVEN',nativeRelease:'NOT_AUTHORIZED_NOT_PUBLISHED'};
}
