import {spawn,execFileSync} from 'node:child_process';
import {writeFileSync} from 'node:fs';
const e='.superpowers/sdd/2026-10-01-awesome-optimization/batch-5';
const child=spawn('powershell',['-NoProfile','-ExecutionPolicy','Bypass','-File','scripts/awesome-optimization/batch-5/build-native-a.ps1'],{windowsHide:true,stdio:'inherit',env:process.env});
let timedOut=false;
const timer=setTimeout(()=>{timedOut=true;execFileSync('taskkill',['/PID',String(child.pid),'/T','/F'],{stdio:'pipe'});},1200000);
const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});clearTimeout(timer);
writeFileSync(e+'/native-a-build-outer.exit.json',JSON.stringify({childPid:child.pid,exitCode:code,timedOut,deadlineMs:1200000},null,2),{flag:'wx'});
process.exitCode=code??1;
