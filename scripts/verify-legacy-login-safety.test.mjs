import { readFileSync } from 'node:fs';
import { expect, test, vi } from 'vitest';
import yaml from 'js-yaml';
import { loginTarget, parseStaffLogin, verifyLegacyLogin } from './verify-legacy-login-safety.mjs';

const props = { audience: 'STAFF', legacyGoogleEnabled: true, oauthOnly: false, passwordEnabled: false, oauthProviders: [], localQaAccounts: '$undefined' };
const push = text => `<script>self.__next_f.push(${JSON.stringify([1, text])})</script>`;
const model = value => ['$', '$La', null, value];
const page = (value = props) => push('a:I[123,["chunk.js"],"LoginForm"]\n') + push(`0:${JSON.stringify({ children: [model(value)] })}\n`);
const input = { url: 'https://app.qidaigo.com/staff/login', stage: 'plan', deployedSourceSha: 'a'.repeat(40), bypassSecret: 'synthetic-private' };
const response = body => new Response(body, { headers: { 'content-type': 'text/html' } });

test('parses only JSON RSC transport with a unique LoginForm STAFF reference', () => {
 expect(parseStaffLogin(page())).toEqual({ legacyGoogleEnabled: true, oauthOnly: false, newProvidersEnabled: false, localQaAccountsConfigured: false });
 const escaped = { ...props, harmless: 'escaped "]}) text' };
 const stream = `a:I[123,[],"LoginForm"]\n0:${JSON.stringify([model(escaped)])}\n`;
 expect(parseStaffLogin(push(stream.slice(0, 21)) + push(stream.slice(21)))).toHaveProperty('legacyGoogleEnabled', true);
 const { localQaAccounts, ...absent } = props;
 expect(localQaAccounts).toBe('$undefined');
 expect(parseStaffLogin(page(absent))).toHaveProperty('localQaAccountsConfigured', false);
});

test('rejects missing, duplicate, wrong component and malformed RSC without evaluation', () => {
 for (const body of ['', '<h1>LoginForm</h1>', page().replace('LoginForm', 'DifferentForm'),
  push('a:I[123,[],"LoginForm"]\n') + push(`0:${JSON.stringify([model(props), model(props)])}\n`),
  '<script>self.__next_f.push([1,evil()])</script>', '<script>self.__next_f.push([1,"unterminated])</script>',
  push('a:I[broken]\n'), push('a:I[123,[],"LoginForm"]\nb:{broken}\n')]) expect(() => parseStaffLogin(body)).toThrow();
 expect(() => parseStaffLogin(page() + push('a:I[123,[],"DifferentForm"]\n'))).toThrow('LOGIN_RSC_INVALID');
});

test('ignores fake transport in HTML comments, text, inert ancestors and nonexecuting script types', () => {
 const safe = page();
 for (const body of [`<!-- ${safe} -->`, `<div>${safe.replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</div>`,
  `<template hidden>${safe}</template>`, `<noscript>${safe}</noscript>`, `<textarea>${safe}</textarea>`,
  safe.replaceAll('<script>', '<script type="application/json">'), safe.replaceAll('<script>', '<script nomodule>'),
  safe.replaceAll('<script>', '<script language="vbscript">'), safe.replaceAll('<script>', '<script src="/external.js">'),
  `<script>const fake = ${JSON.stringify(safe)};</script>`, `<script>/* ${safe} */</script>`])
  expect(() => parseStaffLogin(body)).toThrow();
 expect(parseStaffLogin(`<!-- fake -->${safe}`)).toHaveProperty('legacyGoogleEnabled', true);
 expect(() => parseStaffLogin(safe.replaceAll('self.__next_f.push(', 'if(false) self.__next_f.push('))).toThrow('LOGIN_RSC_INVALID');
 expect(() => parseStaffLogin(safe.replaceAll('<script>', '<script>self.__next_f = [];'))).toThrow('LOGIN_RSC_INVALID');
});

test('requires unique STAFF form reachable from root 0 through model and lazy references', () => {
 const imported = 'a:I[123,[],"LoginForm"]\n';
 const detached = `b:${JSON.stringify(model(props))}\n`;
 expect(() => parseStaffLogin(push(imported + '0:{"children":[]}\n' + detached))).toThrow('LOGIN_STAFF_FORM_NOT_UNIQUE');
 expect(() => parseStaffLogin(push(imported + detached))).toThrow('LOGIN_RSC_INVALID');
 expect(parseStaffLogin(push(imported + '0:{"children":"$Lb"}\n' + detached))).toHaveProperty('legacyGoogleEnabled', true);
 expect(parseStaffLogin(push(imported + '0:{"children":"$b"}\nb:{"children":"$@c"}\nc:' + JSON.stringify(model(props)) + '\n'))).toHaveProperty('legacyGoogleEnabled', true);
 for (const root of ['0:{"children":"$b"}\nb:{"children":"$0"}\n', '0:{"children":"$dead"}\n',
  '0:{"children":["$b","$b"]}\n' + detached]) expect(() => parseStaffLogin(push(imported + root))).toThrow();
 expect(() => parseStaffLogin(page() + push('c:UNKNOWN_FRAME\n'))).toThrow('LOGIN_RSC_INVALID');
});

test('supports only explicitly empty closed Flight async iterables, rejecting ambiguous streams', () => {
 const stream = 'a:I[123,[],"LoginForm"]\n0:' + JSON.stringify({ children: model(props), stream: '$b' }) + '\n';
 expect(parseStaffLogin(push(stream + 'b:X\nb:C\n'))).toHaveProperty('legacyGoogleEnabled', true);
 for (const frames of ['b:X\n', 'b:C\n', 'b:X\nb:C\nb:C\n', 'b:X\nb:' + JSON.stringify(model(props)) + '\nb:C\n'])
  expect(() => parseStaffLogin(push(stream + frames))).toThrow('LOGIN_RSC_INVALID');
});

test('rejects legacy disabled, new providers, OAuth-only and local test credentials', () => {
 for (const change of [{ legacyGoogleEnabled: false }, { legacyGoogleEnabled: undefined }, { oauthOnly: true },
  { oauthProviders: [{ provider: 'GOOGLE', label: 'Google' }] }, { oauthProviders: null }, { localQaAccounts: [] },
  { localQaAccounts: [{ email: 'synthetic', password: 'synthetic' }] }]) expect(() => parseStaffLogin(page({ ...props, ...change }))).toThrow('LOGIN_SAFETY_DRIFT');
});

test('only accepts the public hostname or previously approved exact deployment login URL', () => {
 expect(loginTarget(input.url)).toBe(input.url);
 expect(loginTarget('https://approved.vercel.app/staff/login', 'https://approved.vercel.app')).toBe('https://approved.vercel.app/staff/login');
 for (const url of ['https://other.vercel.app/staff/login', 'http://app.qidaigo.com/staff/login',
  'https://app.qidaigo.com/staff/login?next=x', 'https://app.qidaigo.com/login', 'https://app.qidaigo.com.evil.test/staff/login',
  'https://user:pass@app.qidaigo.com/staff/login', 'https://app.qidaigo.com:443/staff/login#x'])
  expect(() => loginTarget(url, 'https://approved.vercel.app')).toThrow();
});

test('fetch is redirect-error, bounded and sends bypass only as a header; receipt contains no secret', async () => {
 const fetcher = vi.fn(async () => response(page()));
 const receipt = await verifyLegacyLogin(input, fetcher);
 const options = fetcher.mock.calls[0][1];
 expect(options.redirect).toBe('error'); expect(options.signal).toBeInstanceOf(AbortSignal);
 expect(options.headers).toEqual({ 'x-vercel-protection-bypass': 'synthetic-private' });
 expect(JSON.stringify(receipt)).not.toContain('synthetic-private');
 expect(receipt).toMatchObject({ stage: 'plan', deployedSourceSha: input.deployedSourceSha, provesCompletedGoogleLogin: false, provesOAuthSecretEntropy: false, provesDatabaseTarget: false });
});

test('redirects, wrong HTTP/content type, excessive body and missing identity fail closed', async () => {
 await expect(verifyLegacyLogin(input, async () => { throw Error('redirect contains private information'); })).rejects.toThrow('LOGIN_FETCH_FAILED');
 for (const result of [new Response('', { status: 302, headers: { location: '/login' } }),
  new Response(page(), { status: 503 }), new Response(page(), { headers: { 'content-type': 'application/json' } }),
  { ...response(page()), ok: true, redirected: true }]) await expect(verifyLegacyLogin(input, async () => result)).rejects.toThrow('LOGIN_RESPONSE_INVALID');
 await expect(verifyLegacyLogin(input, async () => response('x'.repeat(2_000_001)))).rejects.toThrow('LOGIN_BODY_INVALID');
 await expect(verifyLegacyLogin({ ...input, deployedSourceSha: '' }, async () => response(page()))).rejects.toThrow('LOGIN_IDENTITY_INVALID');
});

test('workflow gates immutable Plan and both sides of promotion, retaining recovery', () => {
 const workflow = yaml.load(readFileSync('.github/workflows/production-readiness.yml', 'utf8'));
 const steps = workflow.jobs['verify-remote'].steps;
 const login = steps.findIndex(step => step.name === 'Verify actual Production legacy login before immutable Plan');
 const plan = steps.findIndex(step => step.name === 'Create immutable Production plan receipt');
 expect(login).toBeGreaterThan(-1); expect(login).toBeLessThan(plan);
 const run = steps.find(step => step.name === 'Promote approved deployment and smoke Production').run;
 expect(run.indexOf('production-release-target.mjs candidate')).toBeLessThan(run.indexOf('verify-legacy-login-safety.mjs candidate'));
 expect(run.indexOf('verify-legacy-login-safety.mjs candidate')).toBeLessThan(run.indexOf('vercel promote'));
 expect(run.indexOf('vercel promote')).toBeLessThan(run.indexOf('verify-legacy-login-safety.mjs post-promotion'));
 expect(run).toContain('verify-legacy-login-safety.mjs recovery');
 expect(run).toContain('trap rollback_on_error ERR');
});
