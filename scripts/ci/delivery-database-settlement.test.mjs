import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {applyLeaseSql,verifyWriterIdentity,writerSettlementSql,verifyWriterSettled} from './delivery-database-settlement.mjs';
import {applySql,SNAPSHOT_SQL,RECOVERY_SIGNATURES} from './delivery-database-recovery.mjs';
const applicationName='stallorder-delivery-'+'a'.repeat(32),leaseKey='9223372036854775807';
const identity=()=>({pid:1234,backendStart:'2026-11-14T05:30:00.123456Z',applicationName,user:'postgres',database:'postgres',
 leaseKey,leaseHeld:true,transactionReadOnly:false,transactionIsolation:'read committed',idleTimeout:'15s'});
const proof=()=>({leaseKey,leaseHeld:true,currentUser:'postgres',sessionUser:'postgres',database:'postgres',
 transactionReadOnly:true,transactionIsolation:'read committed',snapshot:{principal:{},functions:[],migrations:[]}});

test('native lease identity binds the exact writer transaction',()=>{
 assert.deepEqual(verifyWriterIdentity({value:identity(),applicationName,leaseKey}),identity());
});
for(const [name,edit] of [
 ['invalid pid',v=>v.pid=-1],['fractional pid',v=>v.pid=1.1],['foreign user',v=>v.user='other'],
 ['other database',v=>v.database='other'],['wrong application name',v=>v.applicationName='other'],
 ['invalid calendar date',v=>v.backendStart='2026-02-30T05:30:00.123456Z'],
 ['unknown secret field',v=>v.private='PRIVATE-MARKER'],['unheld lease',v=>v.leaseHeld=false],
 ['wrong key',v=>v.leaseKey='42'],['number key',v=>v.leaseKey=42],['readonly writer',v=>v.transactionReadOnly=true],
 ['repeatable read',v=>v.transactionIsolation='repeatable read'],['unbounded idle timeout',v=>v.idleTimeout='0'],
])test('identity rejects '+name+' with fixed diagnostics',()=>{
 const value=identity();edit(value);assert.throws(()=>verifyWriterIdentity({value,applicationName,leaseKey}),
  e=>e.message==='DELIVERY_WRITER_IDENTITY_REJECTED'&&!('actual'in e)&&!JSON.stringify(e).includes('PRIVATE-MARKER'));
});

test('settlement waits for the lease before a separate fresh readonly snapshot statement',()=>{
 assert.throws(()=>writerSettlementSql({identity:identity(),writerExited:false}),{message:'DELIVERY_WRITER_SETTLEMENT_REJECTED'});
 const sql=writerSettlementSql({identity:identity(),writerExited:true});
 assert.match(sql,/BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;/);
 assert.match(sql,/SET LOCAL lock_timeout = '35s';/);assert.match(sql,/SET LOCAL statement_timeout = '40s';/);
 assert.ok(sql.indexOf('pg_advisory_xact_lock('+leaseKey+'::bigint)')<sql.indexOf(SNAPSHOT_SQL));
 assert.match(sql,/END;\n\$delivery_lease\$;\nSELECT/);
 assert.ok(sql.includes(SNAPSHOT_SQL));assert.match(sql,/COMMIT;\n$/);
 assert.ok(!/pg_terminate_backend|pg_cancel_backend|INSERT |UPDATE |DELETE |DROP |ALTER /.test(sql));
});

test('settlement requires an exited client and native readonly lease proof without permitting retry',()=>{
 const out=verifyWriterSettled({identity:identity(),writerExited:true,value:proof()});
 assert.equal(out.writerSettled,true);assert.equal(out.originVerified,false);assert.equal(out.retryAllowed,false);
 assert.equal(out.mutationAuthorized,false);assert.equal(out.releaseAuthorized,false);assert.deepEqual(out.snapshot,proof().snapshot);
 for(const mutate of [v=>v.leaseHeld=false,v=>v.leaseKey='42',v=>v.currentUser='other',v=>v.sessionUser='other',
  v=>v.transactionReadOnly=false,v=>v.transactionIsolation='repeatable read',v=>v.snapshot=null,v=>v.private='PRIVATE-MARKER']) {
  const changed=proof();mutate(changed);
  assert.throws(()=>verifyWriterSettled({identity:identity(),writerExited:true,value:changed}),
   e=>e.message==='DELIVERY_WRITER_SETTLEMENT_REJECTED'&&!('actual'in e));
 }
 assert.throws(()=>verifyWriterSettled({identity:identity(),writerExited:false,value:proof()}),{message:'DELIVERY_WRITER_SETTLEMENT_REJECTED'});
});
for(const key of ['0','-1','9223372036854775808','01',42,'1; SELECT 1','1.1'])
 test('lease rejects noncanonical or out of range key '+key,()=>{
  const value=identity();value.leaseKey=key;
  assert.throws(()=>verifyWriterIdentity({value,applicationName,leaseKey:key}),{message:'DELIVERY_WRITER_IDENTITY_REJECTED'});
 });

test('Apply split retains every original CAS and migration byte without sending mutation before identity',()=>{
 const source=JSON.parse(readFileSync(new URL('./delivery-native-postimage-source.json',import.meta.url)));
 const before={principal:{currentUser:'postgres',sessionUser:'postgres',database:'postgres',superuser:false,bypassRls:true},
  functions:RECOVERY_SIGNATURES.map((signature,i)=>({signature,oid:i<4?100+i:null,
   definition:i<4?'CREATE OR REPLACE FUNCTION public.fixture() RETURNS int LANGUAGE sql AS $$SELECT 1$$;':null,
   owner:i<4?'postgres':null,acl:i<4?source.functions[i].acl:null,config:i<4?['search_path=""']:null,securityDefiner:i<4?true:null})),
  migrations:Array.from({length:146},(_,i)=>({version:String(20200101000000+i),name:'original',statements:['SELECT 1']}))};
 const after={principal:before.principal,functions:source.functions.map((f,i)=>({...f,oid:100+i})),
  migrations:[...before.migrations,source.migrationRecord]};
 const path='supabase/migrations/20261029090000_public_delivery_ordering_hours.sql';
 const section=readFileSync(new URL('./delivery-source/candidate.patch',import.meta.url),'utf8')
  .split(`diff --git a/${path} b/${path}\n`)[1].split('\ndiff --git ')[0];
 const migration=section.split('\n').filter(l=>l.startsWith('+')&&!l.startsWith('+++')).map(l=>l.slice(1)).join('\n')+'\n';
 const original=applySql(before,after,migration),parts=applyLeaseSql({before,after,migration,applicationName,leaseKey});
 const boundary=original.indexOf('DO $delivery_apply$');
 assert.equal(parts.remainder,original.slice(boundary));
 const withoutSettings=parts.prelude.replace("SET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSET LOCAL idle_in_transaction_session_timeout = '15s';\n",'');
 assert.ok(withoutSettings.startsWith(original.slice(0,boundary)));
 assert.ok(parts.prelude.indexOf('SET TRANSACTION')<parts.prelude.indexOf('LOCK TABLE'));
 assert.ok(!parts.prelude.includes('CREATE OR REPLACE FUNCTION'));
 assert.match(parts.prelude,/SET LOCAL idle_in_transaction_session_timeout = '15s';/);
 assert.ok(parts.prelude.indexOf('pg_advisory_xact_lock(')<parts.prelude.indexOf("'backendStart'"));
 assert.equal((parts.prelude+parts.remainder).match(/^BEGIN;/gm).length,1);
 assert.equal((parts.prelude+parts.remainder).match(/^COMMIT;/gm).length,1);
});
