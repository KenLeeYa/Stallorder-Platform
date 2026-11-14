import assert from 'node:assert/strict';
import {applySql,SNAPSHOT_SQL} from './delivery-database-recovery.mjs';

const protect=(code,fn)=>{try{return fn();}catch{throw new Error(code);}};
const literal=value=>"'"+value.replaceAll("'","''")+"'";
function application(value){assert.match(value??'',/^stallorder-delivery-[a-f0-9]{32}$/);return value;}
function key(value){assert.equal(typeof value,'string');assert.match(value,/^[1-9][0-9]{0,18}$/);assert.ok(BigInt(value)<=9223372036854775807n);return value;}
function identity(value,applicationName,leaseKey) {
 assert.deepEqual(Object.keys(value).sort(),['applicationName','backendStart','database','idleTimeout','leaseHeld','leaseKey','pid','transactionIsolation','transactionReadOnly','user']);
 assert.ok(Number.isSafeInteger(value.pid)&&value.pid>0&&value.pid<=2147483647);
 assert.equal(application(value.applicationName),application(applicationName));assert.equal(key(value.leaseKey),key(leaseKey));
 assert.equal(value.user,'postgres');assert.equal(value.database,'postgres');assert.equal(value.leaseHeld,true);
 assert.equal(value.transactionReadOnly,false);assert.equal(value.transactionIsolation,'read committed');assert.equal(value.idleTimeout,'15s');
 assert.match(value.backendStart??'',/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/);
 const milliseconds=value.backendStart.replace(/(\.\d{3})\d{3}Z$/,'$1Z');
 assert.equal(new Date(milliseconds).toISOString(),milliseconds);return structuredClone(value);
}
const acquire=leaseKey=>`DO $delivery_lease$
BEGIN
 PERFORM pg_catalog.pg_advisory_xact_lock(${key(leaseKey)}::bigint);
END;
$delivery_lease$;
`;
const held=leaseKey=>`EXISTS (SELECT 1 FROM pg_catalog.pg_locks l WHERE l.locktype='advisory'
 AND l.pid=pg_catalog.pg_backend_pid() AND l.mode='ExclusiveLock' AND l.granted
 AND l.database=(SELECT oid FROM pg_catalog.pg_database WHERE datname=current_database())
 AND l.classid=(${key(leaseKey)}::bigint >> 32)::oid
 AND l.objid=(${key(leaseKey)}::bigint & 4294967295)::oid AND l.objsubid=1)`;

// Pure builders only. The protected caller must durably bind a random per-attempt
// key before starting the sole non-reconnecting psql child. Send only prelude;
// verify its same-session identity before sending remainder once. The original
// migration/CAS bytes and its single BEGIN/COMMIT remain intact.
export function applyLeaseSql({before,after,migration,applicationName,leaseKey}) {return protect('DELIVERY_WRITER_LEASE_REJECTED',()=>{
 application(applicationName);key(leaseKey);
 const original=applySql(before,after,migration),boundary=original.indexOf('DO $delivery_apply$');
 assert.ok(boundary>0);
 const prefix=original.slice(0,boundary).replace('BEGIN;\n',"BEGIN;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nSET LOCAL idle_in_transaction_session_timeout = '15s';\n");
 const prelude=prefix+`${acquire(leaseKey)}SELECT pg_catalog.jsonb_build_object('pid',a.pid,
 'backendStart',pg_catalog.to_char(a.backend_start AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'applicationName',a.application_name,'user',a.usename,'database',a.datname,
 'leaseKey',${literal(leaseKey)},'leaseHeld',${held(leaseKey)},
 'transactionReadOnly',current_setting('transaction_read_only')='on',
 'transactionIsolation',current_setting('transaction_isolation'),
 'idleTimeout',current_setting('idle_in_transaction_session_timeout'))
 FROM pg_catalog.pg_stat_activity a WHERE a.pid=pg_catalog.pg_backend_pid()
 AND a.application_name=${literal(applicationName)};
`;
 return {prelude,remainder:original.slice(boundary)};
});}
export function verifyWriterIdentity({value,applicationName,leaseKey}) {return protect('DELIVERY_WRITER_IDENTITY_REJECTED',()=>identity(value,applicationName,leaseKey));}

// Actual local child exit is mandatory; an error event or a missing runner is
// insufficient. A new authenticated connection must use this same database/key.
// Separate statements are essential: READ COMMITTED takes a fresh MVCC snapshot
// after waiting for the original transaction's lease. Timeout stays unknown.
// No backend signals, reconnect, write retry or inferred rollback are permitted.
export function writerSettlementSql({identity:writer,writerExited}) {return protect('DELIVERY_WRITER_SETTLEMENT_REJECTED',()=>{
 assert.equal(writerExited,true);writer=identity(writer,writer.applicationName,writer.leaseKey);
 return `BEGIN ISOLATION LEVEL READ COMMITTED READ ONLY;
SET LOCAL statement_timeout = '40s';
SET LOCAL lock_timeout = '35s';
SET LOCAL idle_in_transaction_session_timeout = '15s';
SET LOCAL search_path = pg_catalog;
${acquire(writer.leaseKey)}SELECT pg_catalog.jsonb_build_object('leaseKey',${literal(writer.leaseKey)},'leaseHeld',${held(writer.leaseKey)},
 'currentUser',current_user,'sessionUser',session_user,'database',current_database(),
 'transactionReadOnly',current_setting('transaction_read_only')='on',
 'transactionIsolation',current_setting('transaction_isolation'),'snapshot',(${SNAPSHOT_SQL}));
COMMIT;
`;
});}
export function verifyWriterSettled({identity:writer,writerExited,value}) {return protect('DELIVERY_WRITER_SETTLEMENT_REJECTED',()=>{
 assert.equal(writerExited,true);writer=identity(writer,writer.applicationName,writer.leaseKey);
 const {snapshot,...proof}=value;
 assert.deepEqual(proof,{leaseKey:writer.leaseKey,leaseHeld:true,currentUser:'postgres',sessionUser:'postgres',database:'postgres',
  transactionReadOnly:true,transactionIsolation:'read committed'});
 assert.deepEqual(Object.keys(snapshot).sort(),['functions','migrations','principal']);
 assert.ok(Array.isArray(snapshot.functions)&&Array.isArray(snapshot.migrations));
 assert.ok(Buffer.byteLength(JSON.stringify(snapshot))<=16*1024*1024);
 return {schema:'stallorder-native-writer-settlement/v1',writer,writerSettled:true,snapshot:structuredClone(snapshot),originVerified:false,
  retryAllowed:false,mutationAuthorized:false,releaseAuthorized:false};
});}
