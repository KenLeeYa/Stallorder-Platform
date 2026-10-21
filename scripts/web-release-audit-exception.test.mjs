import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {expect,test} from 'vitest';
import {assertRootAudit as validateAudit} from './lib/web-release-dependency-audit.mjs';
const assertRootAudit=(audit,exception,now=Date.parse('2026-10-20T10:00:00+08:00'))=>validateAudit(audit,exception,now);
const policy=JSON.parse(readFileSync(new URL('./web-release-audit-exception.json',import.meta.url)));
const lock=JSON.parse(readFileSync(new URL('../package-lock.json',import.meta.url)));
test('reviewed lock amendment changes only the approved follow-redirects tuple',()=>{
 // Reverse only the approved tuple, then verify the entire previous lock against its approved digests.
 // This also runs in a shallow CI checkout without trusting a locally available historical object.
 const previous=structuredClone(lock);
 Object.assign(previous.packages['node_modules/follow-redirects'],{version:'1.16.0',resolved:'https://registry.npmjs.org/follow-redirects/-/follow-redirects-1.16.0.tgz',integrity:'sha512-y5rN/uOsadFT/JfYwhxRS5R7Qce+g3zG97+JrtFZlC9klX/W5hD7iiLzScI4nZqUS7DNUdhPgw4xI8W2LuXlUw=='});
 const expected=structuredClone(previous);
 Object.assign(expected.packages['node_modules/follow-redirects'],{version:'1.16.1',resolved:'https://registry.npmjs.org/follow-redirects/-/follow-redirects-1.16.1.tgz',integrity:'sha512-FNvFGzoMLWmE6Yj9spb/zjd7yiNCHiAW9/Tg9CXrQ8wuu32HtlJOwWO11OJafl5FfY3DxTdQ0vj42zU1kvv5jg=='});
 expect(lock).toEqual(expected);
 const hash=value=>createHash('sha256').update(value).digest('hex');
 expect(policy.lockRebind.previousLockSha256).toBe(hash(JSON.stringify(previous)));
 expect(policy.lockRebind.previousLockBytesSha256).toBe(hash(JSON.stringify(previous,null,2)+'\n'));
 expect(policy.lockSha256).toBe(hash(JSON.stringify(lock)));
 expect(policy.lockBytesSha256).toBe(hash(readFileSync(new URL('../package-lock.json',import.meta.url),'utf8').replaceAll('\r\n','\n')));
});
function audit(){return {auditReportVersion:2,metadata:{vulnerabilities:structuredClone(policy.counts)},vulnerabilities:Object.fromEntries(Object.entries(policy.packages).map(([name,p])=>[name,{name,severity:'high',isDirect:p.isDirect,nodes:[p.node],effects:structuredClone(p.effects),range:p.range,via:name==='braces'?[{source:1240992,url:'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm',name:'braces',dependency:'braces',severity:'high',range:'<=3.0.3'}]:structuredClone(p.via)}]))};}
test('exact accepted dev chain remains rejected without explicit exception',()=>{expect(()=>assertRootAudit(audit())).toThrow('VULNERABILITIES');expect(()=>assertRootAudit(audit(),{policy,lock})).not.toThrow();});
test('expired approval and unknown policy cannot pass',()=>{expect(()=>assertRootAudit(audit(),{policy,lock},Date.parse(policy.expiresAt)+1)).toThrow('EXPIRED');expect(()=>assertRootAudit(audit(),{policy:{...policy,advisory:'OTHER'},lock})).toThrow('LOCK_MISMATCH');});
test('same package with a second advisory and unrelated lock metadata drift remain blocking',()=>{const a=audit();a.vulnerabilities.braces.via.push({...a.vulnerabilities.braces.via[0],source:999,url:'https://github.com/advisories/NEW'});expect(()=>assertRootAudit(a,{policy,lock})).toThrow('UNREVIEWED');expect(()=>assertRootAudit(audit(),{policy,lock:{...lock,unreviewed:'change'}})).toThrow('LOCK_MISMATCH');});
test.each(['advisory','severity','node','extra','count','via','version','error'])('rejects unreviewed exception change %s',kind=>{const a=audit(),l=structuredClone(lock);if(kind==='advisory')a.vulnerabilities.braces.via[0].url='https://github.com/advisories/OTHER';if(kind==='severity')a.vulnerabilities.braces.severity='critical';if(kind==='node')a.vulnerabilities.braces.nodes.push('node_modules/extra/braces');if(kind==='extra')a.vulnerabilities.other={};if(kind==='count')a.metadata.vulnerabilities.high=6;if(kind==='via')a.vulnerabilities.micromatch.via.push('other');if(kind==='version')l.packages['node_modules/braces'].version='3.0.4';if(kind==='error')a.error={code:'EAUDIT'};expect(()=>assertRootAudit(a,{policy,lock:l})).toThrow();});
