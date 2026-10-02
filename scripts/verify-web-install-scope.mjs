import {existsSync,readFileSync,readdirSync,realpathSync} from 'node:fs';
import {join,relative,resolve,sep} from 'node:path';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';

const denied=new Set(['@expo/cli','@expo/code-signing-certificates','decode-uri-component','expo','expo-router','node-forge','query-string']);
const inside=(root,path)=>path===root||path.startsWith(root+sep);
const json=path=>JSON.parse(readFileSync(path,'utf8'));
const fail=code=>{throw new Error(code);};

/** Verify the actual clean Web install, including development dependencies and workspace links. */
export function verifyWebInstallScope(directory){
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
 const digest=value=>createHash('sha256').update(value).digest('hex');
 return {status:'PASS',scope:'Web root production + development dependencies and packages/contracts; Native excluded',installedPackages:installed,contractsVersion:contract.version,lockSha256:digest(readFileSync(join(root,'package-lock.json'))),installedGraphSha256:digest(JSON.stringify(graph.sort((a,b)=>a.path.localeCompare(b.path)))),rootProductionDependencies:Object.keys(manifest.dependencies??{}).length,rootDevelopmentDependencies:Object.keys(manifest.devDependencies??{}).length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifyWebInstallScope(process.cwd()),null,2));
