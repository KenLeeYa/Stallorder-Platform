const {withAndroidManifest,withDangerousMod}=require('expo/config-plugins');
const {mkdirSync,writeFileSync}=require('node:fs');
const {join}=require('node:path');
module.exports=config=>{
 config=withAndroidManifest(config,mod=>{mod.modResults.manifest.application[0].$['android:networkSecurityConfig']='@xml/local_loopback';return mod;});
 return withDangerousMod(config,['android',async mod=>{
  const dir=join(mod.modRequest.platformProjectRoot,'app/src/main/res/xml');mkdirSync(dir,{recursive:true});
  writeFileSync(join(dir,'local_loopback.xml'),'<?xml version="1.0" encoding="utf-8"?><network-security-config><base-config cleartextTrafficPermitted="false"/><domain-config cleartextTrafficPermitted="true"><domain includeSubdomains="false">127.0.0.1</domain><domain includeSubdomains="false">localhost</domain></domain-config></network-security-config>');return mod;
 }]);
};
