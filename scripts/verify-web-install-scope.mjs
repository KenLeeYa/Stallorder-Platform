import {existsSync,readFileSync,readdirSync,realpathSync,writeFileSync} from 'node:fs';
import {basename,join,relative,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const denied=new Set(['@expo/cli','@expo/code-signing-certificates','decode-uri-component','expo','expo-router','node-forge','query-string']);
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const fail=code=>{throw new Error(code);};
// npm CycloneDX uses the root directory as display name; its ref retains package identity.
function verifySbomRoot(directory,manifest,lock,component){
 const locked=lock.packages?.[''];
 const purl=`pkg:npm/${encodeURIComponent(manifest.name).replaceAll('%2F','/')}@${manifest.version}`;
 if(locked?.name!==manifest.name||locked.version!==manifest.version||component?.version!==manifest.version||component['bom-ref']!==`${manifest.name}@${manifest.version}`||![manifest.name,basename(realpathSync(directory))].includes(component.name)||(component.purl!==undefined&&component.purl!==purl))fail('WEB_INSTALL_SBOM_ROOT_INVALID');
}

/** Verify the actual clean Web install, including development dependencies and workspace links. */
export function verifyWebInstallScope(directory,sbom){
 const root=realpathSync(directory),lock=json(join(root,'package-lock.json')),manifest=json(join(root,'package.json'));
 const contractPath=join(root,'packages/contracts'),contract=json(join(contractPath,'package.json'));
 if(existsSync(join(root,'apps/mobile/node_modules'))&&readdirSync(join(root,'apps/mobile/node_modules')).length)fail('WEB_INSTALL_MOBILE_WORKSPACE_REMAINS');
 const seen=new Set(),graph=[];let installed=0;
 const walkModules=directory=>{
  if(!existsSync(directory))return;
  const actual=realpathSync(directory);
  if(!inside(root,actual)||inside(join(root,'apps/mobile'),actual))fail('WEB_INSTALL_PATH_OUTSIDE_SCOPE');
  const entries=readdirSync(directory,{withFileTypes:true}).filter(entry=>!entry.name.startsWith('.'));
  const paths=entries.flatMap(entry=>entry.name.startsWith('@')?readdirSync(join(directory,entry.name)).map(name=>join(directory,entry.name,name)):[join(directory,entry.name)]);
  for(const path of paths){
   const target=realpathSync(path),key=relative(root,path).replaceAll('\\','/');
   if(!inside(root,target)||inside(join(root,'apps/mobile'),target))fail('WEB_INSTALL_PATH_OUTSIDE_SCOPE');
   if(!existsSync(join(path,'package.json')))fail('WEB_INSTALL_PACKAGE_MANIFEST_MISSING');
   const pkg=json(join(path,'package.json'));
   if(denied.has(pkg.name)||/^(?:expo(?:$|-)|@expo\/|react-native(?:$|-)|@react-native\/)/u.test(pkg.name))fail('WEB_INSTALL_NATIVE_PACKAGE');
   const entry=lock.packages?.[key];
   if(!entry)fail('WEB_INSTALL_PACKAGE_NOT_LOCKED');
   const version=entry.link?lock.packages[entry.resolved]?.version:entry.version;
   if(version!==pkg.version)fail('WEB_INSTALL_VERSION_DRIFT');
   const expectedName=entry.name??key.split('node_modules/').at(-1);
   if(pkg.name!==expectedName)fail('WEB_INSTALL_PACKAGE_IDENTITY_DRIFT');
   if(entry.link&&(entry.resolved!=='packages/contracts'||target!==realpathSync(contractPath)))fail('WEB_INSTALL_UNEXPECTED_WORKSPACE_LINK');
   if(seen.has(target))continue;
   graph.push({path:key,name:pkg.name,version:pkg.version,target:relative(root,target).replaceAll('\\','/')});
   seen.add(target);installed++;walkModules(join(path,'node_modules'));
  }
 };
 walkModules(join(root,'node_modules'));
 walkModules(join(contractPath,'node_modules'));
 const localLock=join(root,'node_modules/.package-lock.json');
 if(existsSync(localLock)&&Object.keys(json(localLock).packages??{}).some(path=>path==='apps/mobile'||path==='node_modules/@stallorder/mobile'||path.startsWith('apps/mobile/')))fail('WEB_INSTALL_MOBILE_LOCK_ENTRY');
 for(const [owner,pkg] of [[root,manifest],[contractPath,contract]]){
  for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})){
   const path=join(owner,'node_modules',name);
   const rootPath=join(root,'node_modules',name);
   if(!existsSync(path)&&!existsSync(rootPath))fail('WEB_INSTALL_REQUIRED_DEPENDENCY_MISSING');
   // Resolution must see the workspace package, not an unrelated globally installed module.
   if(name==='@stallorder/contracts'&&(!existsSync(rootPath)||realpathSync(rootPath)!==realpathSync(contractPath)))fail('WEB_INSTALL_CONTRACT_LINK_INVALID');
   const selected=existsSync(path)?path:rootPath;
   const actual=realpathSync(selected);
   if(!inside(root,actual)||!seen.has(actual))fail('WEB_INSTALL_DECLARED_PACKAGE_NOT_AUDITED');
   const identity=json(join(selected,'package.json'));
   if(identity.name!==name)fail('WEB_INSTALL_DECLARED_PACKAGE_IDENTITY_DRIFT');
  }
 }
 if(lock.packages?.['packages/contracts']?.version!==contract.version||manifest.dependencies?.['@stallorder/contracts']!==contract.version)fail('WEB_INSTALL_CONTRACT_VERSION_DRIFT');
 if(sbom){
  if(sbom.bomFormat!=='CycloneDX'||!Array.isArray(sbom.components))fail('WEB_INSTALL_SBOM_INVALID');
  const components=new Set(),refs=new Map();
  const rootComponent=sbom.metadata?.component;
  verifySbomRoot(root,manifest,lock,rootComponent);
  refs.set(rootComponent['bom-ref'],rootComponent);
  for(const component of sbom.components){
   const name=component.group?`${component.group}/${component.name}`:component.name;
   if(typeof name!=='string'||typeof component.version!=='string')fail('WEB_INSTALL_SBOM_INVALID');
   if(denied.has(name)||/^(?:expo(?:$|-)|@expo\/|react-native(?:$|-)|@react-native\/)/u.test(name))fail('WEB_INSTALL_SBOM_NATIVE_PACKAGE');
   if(typeof component['bom-ref']!=='string'||refs.has(component['bom-ref']))fail('WEB_INSTALL_SBOM_REF_COLLISION');
   refs.set(component['bom-ref'],component);
   components.add(`${name}@${component.version}`);
  }
  for(const pkg of graph)if(!components.has(`${pkg.name}@${pkg.version}`))fail('WEB_INSTALL_SBOM_PACKAGE_MISSING');
  if(!Array.isArray(sbom.dependencies))fail('WEB_INSTALL_SBOM_EDGES_INVALID');
  const edges=new Map();
  for(const entry of sbom.dependencies){
   if(!refs.has(entry.ref)||edges.has(entry.ref)||!Array.isArray(entry.dependsOn)||entry.dependsOn.some(ref=>!refs.has(ref)))fail('WEB_INSTALL_SBOM_EDGES_INVALID');
   edges.set(entry.ref,new Set(entry.dependsOn));
  }
  const componentFor=(name,version)=>sbom.components.filter(component=>(component.group?`${component.group}/${component.name}`:component.name)===name&&component.version===version);
  for(const [owner,pkg,ownerRef] of [[root,manifest,rootComponent['bom-ref']],[contractPath,contract,componentFor(contract.name,contract.version)[0]?.['bom-ref']]]){
   for(const name of Object.keys({...pkg.dependencies,...pkg.devDependencies})){
    const nested=join(owner,'node_modules',name),selected=existsSync(nested)?nested:join(root,'node_modules',name),installed=json(join(selected,'package.json'));
    const matches=componentFor(name,installed.version);
    if(!matches.some(component=>edges.get(ownerRef)?.has(component['bom-ref'])))fail('WEB_INSTALL_SBOM_DECLARED_EDGE_MISSING');
   }
  }
 }
 const digest=value=>createHash('sha256').update(value).digest('hex');
 return {status:'PASS',scope:'Web root production + development dependencies and packages/contracts; Native excluded',installedPackages:installed,installedGraph:graph.sort((a,b)=>a.path.localeCompare(b.path)),contractsVersion:contract.version,sbom:sbom?'PASS':'NOT_REQUESTED',lockSha256:digest(readFileSync(join(root,'package-lock.json'))),installedGraphSha256:digest(JSON.stringify(graph)),rootProductionDependencies:Object.keys(manifest.dependencies??{}).length,rootDevelopmentDependencies:Object.keys(manifest.devDependencies??{}).length};
}
/** Preserve npm's raw document; explicitly supplement only its verified omitted workspace. */
export function supplementSharedWorkspaceSbom(directory,raw){
 const receipt=verifyWebInstallScope(directory),root=json(join(directory,'package.json')),contract=json(join(directory,'packages/contracts/package.json'));
 if(raw.bomFormat!=='CycloneDX'||!Array.isArray(raw.components)||!Array.isArray(raw.dependencies))fail('WEB_INSTALL_SBOM_INVALID');
 const result=structuredClone(raw),nameOf=component=>component.group?`${component.group}/${component.name}`:component.name;
 const componentFor=(name,version)=>result.components.find(component=>nameOf(component)===name&&component.version===version);
 const rootComponent=result.metadata?.component;
 verifySbomRoot(directory,root,json(join(directory,'package-lock.json')),rootComponent);
 const rootEdges=result.dependencies.find(entry=>entry.ref===rootComponent['bom-ref']);
 if(!rootEdges||!Array.isArray(rootEdges.dependsOn))fail('WEB_INSTALL_SBOM_ROOT_EDGES_MISSING');
 if(result.components.some(component=>nameOf(component)==='@stallorder/contracts'))fail('WEB_INSTALL_SBOM_CONTRACT_ALREADY_PRESENT');
 // Only the independently verified contracts workspace omission is repairable.
 for(const pkg of receipt.installedGraph)if(pkg.name!=='@stallorder/contracts'&&!componentFor(pkg.name,pkg.version))fail('WEB_INSTALL_SBOM_PACKAGE_MISSING');
 const contractRef=`pkg:npm/%40stallorder/contracts@${contract.version}`;
 if(result.components.some(component=>component['bom-ref']===contractRef)||result.dependencies.some(entry=>entry.ref===contractRef))fail('WEB_INSTALL_SBOM_REF_COLLISION');
 const links=[];
 for(const dependency of Object.keys(contract.dependencies??{})){
  const nested=join(directory,'packages/contracts/node_modules',dependency),path=existsSync(nested)?nested:join(directory,'node_modules',dependency);
  const installed=json(join(path,'package.json')),component=componentFor(dependency,installed.version);
  if(typeof component?.['bom-ref']!=='string')fail('WEB_INSTALL_SBOM_DEPENDENCY_REF_MISSING');
  links.push(component['bom-ref']);
 }
 result.components.push({type:'library',group:'@stallorder',name:'contracts',version:contract.version,'bom-ref':contractRef,purl:contractRef,properties:[{name:'stallorder:evidence',value:'verified installed workspace link, package-lock and manifest'}]});
 rootEdges.dependsOn.push(contractRef);
 result.dependencies.push({ref:contractRef,dependsOn:links});
 result.properties=[...(result.properties??[]),{name:'stallorder:sbom-kind',value:'supplemented-shared-workspace; npm raw document retained separately'}];
 verifyWebInstallScope(directory,result);
 return {sbom:result,receipt:{...receipt,sbom:'PASS',supplementedWorkspace:contract.name,workspaceEdges:links.length+1}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);
 if(args.length===3&&args[0]==='--supplement-sbom'){
  const input=resolve(args[1]),output=resolve(args[2]);
  if(input===output||existsSync(output))fail('WEB_INSTALL_SBOM_OUTPUT_EXISTS');
  const result=supplementSharedWorkspaceSbom(process.cwd(),json(input));
  writeFileSync(output,JSON.stringify(result.sbom,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify(result.receipt,null,2));
 }else{
  if(args.length&&!(args.length===2&&args[0]==='--sbom'))fail('WEB_INSTALL_ARGUMENTS_INVALID');
  console.log(JSON.stringify(verifyWebInstallScope(process.cwd(),args.length?json(resolve(args[1])):undefined),null,2));
 }
}
