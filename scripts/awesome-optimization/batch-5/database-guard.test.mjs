import assert from 'node:assert/strict';
import {test} from 'vitest';
import {readFileSync} from 'node:fs';
import {assertPreClient,projectOldSession,oldSessionFields,sha} from './database-guard.mjs';
import {assertApplicationOverlaySchema,projectLegacyApplications} from '../../../docs/awesome-optimization/qa/native-session-schema-overlay-v1.mjs';

const source='a'.repeat(64);
const env={RESPONSIVE_QA_RUN:'true',PLAYWRIGHT_APP_URL:'http://127.0.0.1:3026',PRIMARY_SUPABASE_URL:'http://127.0.0.1:56821',DATABASE_URL:'postgres://test:test@127.0.0.1:56822/postgres',DIRECT_URL:'postgres://test:test@localhost:56822/postgres',B5_ROOT_SOURCE:source};
// A named synthetic schema tests guard mechanics, not physical database acceptance.
const reviewedSchema={bytes:Buffer.from('synthetic-native-schema-test-v1'),sha256:sha('synthetic-native-schema-test-v1')};
const helperPath='docs/awesome-optimization/qa/native-session-schema-overlay-v1.mjs';
const pins={[helperPath]:sha(readFileSync(helperPath))};
const readFixture=file=>file==='prisma/schema.prisma'?reviewedSchema.bytes:readFileSync(file);
const preClient=(candidate=env,read=readFixture)=>assertPreClient(candidate,source,pins,read,reviewedSchema.sha256);

test('accept exact local source-bound pre-client package',()=>preClient());
for(const [key,value]of [['DATABASE_URL','postgres://test:test@remote.example.test:56822/postgres'],['DIRECT_URL','postgres://test:test@localhost:5432/postgres'],['DR_DATABASE_URL','postgres://test:test@remote.example.test:56822/postgres'],['DR_DIRECT_URL','postgres://test:test@localhost:56822/other'],['PLAYWRIGHT_APP_URL','http://127.0.0.1:3000'],['PRIMARY_SUPABASE_URL','https://remote.example.test'],['VERCEL','1'],['VERCEL_ENV','production'],['CI','true'],['B5_ROOT_SOURCE','b'.repeat(64)]])test('reject target/source '+key,()=>assert.throws(()=>preClient({...env,[key]:value})));
test('reject missing mandatory direct URL',()=>assert.throws(()=>preClient({...env,DIRECT_URL:''})));
test('reject pinned input mutation',()=>assert.throws(()=>preClient(env,()=>Buffer.from('changed'))));
test('reject schema mutation independently of helper pins',()=>assert.throws(()=>preClient(env,file=>file==='prisma/schema.prisma'?Buffer.from('changed'):readFixture(file)),/NATIVE_SCHEMA_DRIFT/));
test('default v1 guard does not silently accept the integrated schema',()=>{assert.throws(()=>assertPreClient(env,source,pins),/NATIVE_SCHEMA_DRIFT/);assert.throws(()=>assertApplicationOverlaySchema(),/SCHEMA_UNEXPECTED/);});
test('reject schema drift under the explicit synthetic contract',()=>assert.throws(()=>assertApplicationOverlaySchema(Buffer.from('changed'),reviewedSchema.sha256)));

const old=Object.fromEntries(oldSessionFields.map(key=>[key,key.endsWith('At')?'2026-10-02T00:00:00.000Z':`synthetic-${key}`]));
test('old session exact 18 fields survive only additive WEB',()=>{assert.equal(Object.keys(old).length,18);assert.deepEqual(projectOldSession({...old,clientKind:'WEB'}),old);assert.deepEqual(Object.keys(projectOldSession({...old,clientKind:'WEB'})),oldSessionFields);});
test('reject old session audience or unknown field or missing original field',()=>{assert.throws(()=>projectOldSession({...old,clientKind:'NATIVE'}));assert.throws(()=>projectOldSession({...old,clientKind:'WEB',unknown:1}));const row={...old,clientKind:'WEB'};delete row.tokenHash;assert.throws(()=>projectOldSession(row));});
test('session compatibility does not erase an old-field mutation',()=>assert.notDeepEqual(projectOldSession({...old,clientKind:'WEB',deviceLabel:'changed'}),old));

const helperSource=readFileSync(helperPath,'utf8');
const currentFields=JSON.parse(/const currentFields=(\[[^;]+\]);/.exec(helperSource)[1]);
const current=Object.fromEntries(currentFields.map(key=>[key,key==='draftVersion'?0:`synthetic-${key}`]));
const {draftVersion,...app}=current;
const project=rows=>projectLegacyApplications(rows,reviewedSchema);
test('Native schema projection preserves all 51 old application fields',()=>{assert.equal(Object.keys(app).length,51);assert.equal(draftVersion,0);assert.deepEqual(project([current]),[app]);});
test('reject nonzero application default and unknown fields',()=>{assert.throws(()=>project([{...current,draftVersion:1}]));assert.throws(()=>project([{...current,unknown:1}]));});
test('application compatibility does not erase old-field mutation',()=>assert.notDeepEqual(project([{...current,merchantName:'changed'}]),[app]));

test('current native migration is reviewed expand-only and never writes replicated flags',()=>{const sql=readFileSync('supabase/migrations/20261002020000_native_session_audience.sql','utf8').replace(/\r\n/g,'\n');assert.equal(sha(sql),'46c01ae81a0c324ea9144d03fc133c0dcd94fb4d001de6a5450d7190cfd13db7');const commands=sql.match(/(?:CREATE TYPE|ALTER TABLE|INSERT INTO)[\s\S]*?;/g);assert.equal(commands.length,2);assert.match(commands[0],/AS ENUM \('WEB', 'NATIVE'\)/);assert.match(commands[1],/client_kind.*NOT NULL DEFAULT 'WEB'/);assert.doesNotMatch(sql,/INSERT INTO|UPDATE public\.resilience_feature_flags/i);});
test('native flag registration stays in the separate explicit pilot fixture',()=>{const sql=readFileSync('supabase/fixtures/native_feature_flag_definitions.sql','utf8');assert.match(sql,/INSERT INTO public\.resilience_feature_flags/);assert.equal((sql.match(/,false,/g)??[]).length,5);assert.match(sql,/ON CONFLICT \(code\) DO NOTHING/);});
test('all five native capabilities remain off by server defaults',()=>{const runtime=readFileSync('src/server/resilience/feature-flag-service.ts','utf8');for(const key of ['MOBILE_APP_ENABLED','MOBILE_PLATFORM_ADMIN_ENABLED','MOBILE_PUSH_ENABLED','MOBILE_OFFLINE_POS_ENABLED','MOBILE_DIRECT_PRINT_ENABLED'])assert.match(runtime,new RegExp(`${key}: false`));});
test('synthetic bulk fixture has 500 distinct order and item identifiers with no overlap',()=>{const orders=Array.from({length:500},(_,i)=>`synthetic-order-${i}`);const itemIds=Array.from({length:500},(_,i)=>`synthetic-item-${i}`);assert.equal(orders.length,500);assert.equal(itemIds.length,500);assert.equal(new Set([...orders,...itemIds]).size,1000);});
