import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const directory = '.superpowers/sdd/2026-10-01-awesome-optimization/batch-2';
mkdirSync(`${directory}/before`, {recursive:true});
const paths = ['scripts/build-responsive-qa.mjs','scripts/responsive-build-provenance.mjs','scripts/responsive-build-provenance.test.mjs','package.json','package-lock.json','src/lib/catalog-data.ts','src/lib/report-scope.ts','src/lib/report-data.ts','src/components/shared-catalog-manager.tsx','src/components/lazy-shared-catalog-manager.tsx','src/components/order-history-table.tsx','src/app/merchant/catalog/page.tsx','src/app/merchant/reports/orders/page.tsx','src/app/admin/merchant-applications/page.tsx','src/app/admin/merchant-applications/[applicationId]/page.tsx','src/app/api/admin/merchant-applications/[applicationId]/route.ts','src/server/merchant-applications/merchant-application-admin-service.ts','src/components/merchant-application-review-actions.tsx','src/lib/csv.ts','src/lib/csv.test.ts','src/lib/public-storefront.ts','src/components/storefront-mode-nav.tsx','docs/awesome-optimization/API_AND_CACHE_CONTRACTS.md','docs/awesome-optimization/SEARCH_BI_DESIGN.md','docs/ARCHITECTURE_AND_FEATURE_CHANGELOG.md'];
const manifest = paths.map(path => {
 const snapshot = `${directory}/before/${path.replaceAll('/','__')}.before`;
 let bytes;
 try { bytes=readFileSync(path); } catch(error){
  if(error.code!=='ENOENT')throw error;
  try { readFileSync(snapshot); throw Object.assign(Error(`PREIMAGE_ALREADY_CAPTURED:${path}`),{code:'EEXIST'}); }
  catch(snapshotError){if(snapshotError.code!=='ENOENT')throw snapshotError;}
  bytes=null;
 }
 if(bytes)try{writeFileSync(snapshot,bytes,{flag:'wx'});}
 catch(error){if(error.code==='EEXIST')throw Object.assign(Error(`PREIMAGE_ALREADY_CAPTURED:${path}`),{code:'EEXIST',cause:error});throw error;}
 return {path,existed:!!bytes,sha256:bytes?createHash('sha256').update(bytes).digest('hex'):null,snapshot:bytes?snapshot:null};
});
writeFileSync(`${directory}/before-manifest.json`,JSON.stringify({at:new Date().toISOString(),head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),paths:manifest},null,2)+'\n',{flag:'wx'});
writeFileSync(`${directory}/before-owned.patch`,execFileSync('git',['diff','--',...paths],{maxBuffer:64*1024*1024}),{flag:'wx'});
console.log(`Captured ${paths.length} preimages`);
