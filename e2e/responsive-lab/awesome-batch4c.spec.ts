import {readFileSync} from 'node:fs';
import {test} from '@playwright/test';
import {openGuardedDatabase} from '../../docs/awesome-optimization/qa/live-fixture-guard.mjs';
import {readResponsiveBuildProvenance} from '../../scripts/responsive-build-provenance.mjs';
import {runLegacyManagementAcceptance,type LegacyManagementFixture} from './awesome-batch4c-acceptance';

test('legacy disabled Mock management and private authority lifecycle',async({page,browser})=>{
 test.setTimeout(180000);
 readResponsiveBuildProvenance({expectedSourceSha256:process.env.AWESOME_QA_EXPECTED_SOURCE_SHA256});
 const db=await openGuardedDatabase();
 try{const fixture=JSON.parse(readFileSync('.superpowers/sdd/2026-10-01-awesome-optimization/batch-4c/mounted-fixture.json','utf8')) as LegacyManagementFixture;
  await runLegacyManagementAcceptance(page,browser,db,fixture,()=>{});
 }finally{await db.$disconnect();}
});
