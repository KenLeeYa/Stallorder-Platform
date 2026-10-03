import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
// Root-reviewed immutable repair receipt: fix-1/rpc-apply-catalogue.json.
export const revocationFunctionSha256='babf8ed5f9e5e324c4fb656563041e0776c95d068c5b47c89e71d7147bf87b86';
export function assertLegacyContactRevocationEvidence(fn){
 assert.equal(createHash('sha256').update(JSON.stringify(fn)).digest('hex'),revocationFunctionSha256,'LEGACY_REVOCATION_FUNCTION_DRIFT');
}
export async function assertLegacyContactRevocationCatalogue(tx){
 const [fn]=await tx.$queryRaw`select p.oid::regprocedure::text as signature,pg_get_functiondef(p.oid) as definition,pg_get_function_result(p.oid) as result,p.prosecdef,p.provolatile,p.proconfig,pg_get_userbyid(p.proowner) as owner,p.proacl::text as acl from pg_proc p where p.oid='public.revoke_line_contact_link(uuid)'::regprocedure`;
 assertLegacyContactRevocationEvidence(fn);return fn;
}
