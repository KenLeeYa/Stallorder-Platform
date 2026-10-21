import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import ts from 'typescript';

const htmlParser = createRequire(import.meta.url)('next/dist/compiled/node-html-parser/index.js');
const fail = code => { throw Error(code); };
const limit = 2_000_000;
export function loginTarget(value, approvedDeployment) {
 const url = new URL(value);
 if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/staff/login' || url.search || url.hash)
  fail('LOGIN_TARGET_INVALID');
 if (url.origin !== 'https://app.qidaigo.com') {
  if (!/^https:\/\/[a-zA-Z0-9-]+\.vercel\.app$/.test(approvedDeployment ?? '') || url.origin !== approvedDeployment)
   fail('LOGIN_TARGET_INVALID');
 }
 return url.href;
}

export function parseStaffLogin(html) {
 if (typeof html !== 'string' || Buffer.byteLength(html) > limit) fail('LOGIN_BODY_INVALID');
 let transport = '';
 const document = htmlParser.parse(html);
 for (const script of document.querySelectorAll('script')) {
  let inert = false;
  for (let parent = script.parentNode; parent; parent = parent.parentNode) {
   if (['TEMPLATE', 'NOSCRIPT', 'TEXTAREA', 'TITLE', 'XMP', 'IFRAME', 'NOEMBED', 'NOFRAMES', 'PLAINTEXT'].includes(parent.tagName)) inert = true;
  }
  const type = (script.getAttribute('type') ?? '').trim().toLowerCase();
  if (inert || script.hasAttribute('src') || script.hasAttribute('nomodule')
   || (!type && script.hasAttribute('language') && !/^javascript$/i.test(script.getAttribute('language')))
   || !['', 'text/javascript', 'application/javascript'].includes(type)) continue;
  const source = ts.createSourceFile('inline.js', script.rawText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  const calls = [];
  const inspect = node => {
   if (ts.isCallExpression(node) && node.expression.getText(source) === 'self.__next_f.push') calls.push(node);
   ts.forEachChild(node, inspect);
  };
  inspect(source);
  if (!calls.length) continue;
  if (source.parseDiagnostics.length || source.statements.some(statement => !ts.isEmptyStatement(statement)
   && (!ts.isExpressionStatement(statement) || !calls.includes(statement.expression)))) fail('LOGIN_RSC_INVALID');
  for (const call of calls) {
   // Only a direct, unconditional statement transports server-rendered Next data.
   if (!ts.isExpressionStatement(call.parent) || call.parent.parent !== source || call.arguments.length !== 1) fail('LOGIN_RSC_INVALID');
   let push;
   try { push = JSON.parse(call.arguments[0].getText(source)); } catch { fail('LOGIN_RSC_INVALID'); }
   if (!Array.isArray(push)) fail('LOGIN_RSC_INVALID');
   if (push[0] === 1) {
    if (push.length !== 2 || typeof push[1] !== 'string') fail('LOGIN_RSC_INVALID');
    transport += push[1];
   } else if (push[0] !== 0 && push[0] !== 2) fail('LOGIN_RSC_INVALID');
  }
 }
 const forms = new Set(), models = new Map(), imports = new Set(), streams = new Map();
 for (const line of transport.split('\n')) {
  if (!line) continue;
  if (line.startsWith(':HL')) {
   try { if (!Array.isArray(JSON.parse(line.slice(3)))) fail('LOGIN_RSC_INVALID'); } catch { fail('LOGIN_RSC_INVALID'); }
   continue;
  }
  const match = /^([0-9a-f]+):(.*)$/i.exec(line);
  if (!match) fail('LOGIN_RSC_INVALID');
  const id = match[1].toLowerCase(), payload = match[2];
  // React Flight X opens an async iterable, and an empty C closes it.
  // Only an explicitly empty, closed iterable can be excluded from the model graph.
  if (payload === 'X' && !models.has(id) && !imports.has(id) && !streams.has(id)) { streams.set(id, 'open'); continue; }
  if (payload === 'C' && streams.get(id) === 'open') { streams.set(id, 'closed'); continue; }
  if (models.has(id) || imports.has(id) || streams.has(id)) fail('LOGIN_RSC_INVALID');
  const imported = payload.startsWith('I[');
  let value;
  try { value = JSON.parse(imported ? payload.slice(1) : payload); } catch { fail('LOGIN_RSC_INVALID'); }
  if (imported) {
   if (!Array.isArray(value) || value.length < 3 || !Array.isArray(value[1]) || typeof value[2] !== 'string') fail('LOGIN_RSC_INVALID');
   imports.add(id);
   if (value[2] === 'LoginForm') forms.add(`$L${id}`);
  } else models.set(id, value);
 }
 if (!models.has('0')) fail('LOGIN_RSC_INVALID');
 const found = [], active = new Set();
 let visited = 0;
 const visit = (value, depth = 0) => {
  if (depth > 100 || ++visited > 100_000) fail('LOGIN_RSC_INVALID');
  if (typeof value === 'string') {
   const reference = /^\$(?:L|@)?([0-9a-f]+)$/i.exec(value);
   if (!reference) return;
   const id = reference[1].toLowerCase();
   if (imports.has(id) || streams.get(id) === 'closed') return;
   if (!models.has(id) || active.has(id)) fail('LOGIN_RSC_INVALID');
   active.add(id); visit(models.get(id), depth + 1); active.delete(id);
   return;
  }
  if (!value || typeof value !== 'object') return;
  if (Array.isArray(value) && value[0] === '$' && forms.has(value[1]) && value[3]?.audience === 'STAFF') found.push(value[3]);
  for (const child of Object.values(value)) visit(child, depth + 1);
 };
 active.add('0'); visit(models.get('0'));
 if (found.length !== 1) fail('LOGIN_STAFF_FORM_NOT_UNIQUE');
 const props = found[0];
 if (props.legacyGoogleEnabled !== true || props.oauthOnly !== false || !Array.isArray(props.oauthProviders) || props.oauthProviders.length !== 0
  || (Object.hasOwn(props, 'localQaAccounts') && props.localQaAccounts !== '$undefined')) fail('LOGIN_SAFETY_DRIFT');
 return { legacyGoogleEnabled: true, oauthOnly: false, newProvidersEnabled: false, localQaAccountsConfigured: false };
}

export async function verifyLegacyLogin({ url, approvedDeployment, stage, deployedSourceSha, bypassSecret }, request = fetch) {
 if (!['plan', 'candidate', 'pre-promotion', 'post-promotion', 'recovery'].includes(stage) || !/^[a-f0-9]{40}$/.test(deployedSourceSha ?? '')) fail('LOGIN_IDENTITY_INVALID');
 const target = loginTarget(url, approvedDeployment);
 let response;
 try { response = await request(target, { redirect: 'error', signal: AbortSignal.timeout(30_000), headers: bypassSecret ? { 'x-vercel-protection-bypass': bypassSecret } : {} }); }
 catch { fail('LOGIN_FETCH_FAILED'); }
 if (!response.ok || response.redirected || (response.url && response.url !== target) || !response.headers.get('content-type')?.includes('text/html')) fail('LOGIN_RESPONSE_INVALID');
 const reader = response.body?.getReader();
 if (!reader) fail('LOGIN_BODY_INVALID');
 const chunks = []; let bytes = 0;
 try {
  while (true) { const part = await reader.read(); if (part.done) break; bytes += part.value.length; if (bytes > limit) { await reader.cancel(); fail('LOGIN_BODY_INVALID'); } chunks.push(Buffer.from(part.value)); }
 } catch (error) { if (error.message === 'LOGIN_BODY_INVALID') throw error; fail('LOGIN_FETCH_FAILED'); }
 finally { reader.releaseLock(); }
 return { stage, url: target, deployedSourceSha, sourceIdentityEvidence: 'WORKFLOW_SUPPLIED_NOT_HTML_ATTESTED',
  checkedAt: new Date().toISOString(), status: 'LEGACY_LOGIN_UI_SAFETY_VERIFIED', ...parseStaffLogin(Buffer.concat(chunks).toString('utf8')),
  provesOAuthSecretEntropy: false, provesDatabaseTarget: false, provesCompletedGoogleLogin: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
 try {
  const receipt = await verifyLegacyLogin({ url: process.env.LEGACY_LOGIN_URL ?? 'https://app.qidaigo.com/staff/login',
   approvedDeployment: process.env.APPROVED_PRODUCTION_DEPLOYMENT, stage: process.argv[2], deployedSourceSha: process.env.LEGACY_LOGIN_DEPLOYED_SOURCE_SHA,
   bypassSecret: process.env.VERCEL_AUTOMATION_BYPASS_SECRET });
  writeFileSync(process.argv[3], JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
  console.log('LEGACY_LOGIN_UI_SAFETY_VERIFIED');
 } catch (error) { console.error(/^LOGIN_[A-Z_]+$/.test(error.message) ? error.message : 'LOGIN_VERIFY_FAILED'); process.exitCode = 1; }
}
