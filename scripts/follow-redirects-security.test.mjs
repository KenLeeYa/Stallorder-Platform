import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const redirects = require('follow-redirects');
const listen = async handler => {
  const server = createServer(handler);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
};
const close = server => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
const request = (url, options) => new Promise((resolve, reject) => {
  const req = redirects.http.request(url, { ...options, timeout: 2000 }, res => {
    let body = '';
    res.setEncoding('utf8'); res.on('data', chunk => { body += chunk; });
    res.on('end', () => { try { resolve(JSON.parse(body)); } catch (error) { reject(error); } });
    res.on('error', reject);
  });
  req.on('error', reject); req.on('timeout', () => req.destroy(Error('LOOPBACK_REQUEST_TIMEOUT'))); req.end(options.body);
});

test.each(['object', 'array'])('cross-origin redirect strips built-in credentials from %s headers', async representation => {
  const destination = await listen((req, res) => { res.end(JSON.stringify(req.headers)); });
  const source = await listen((_req, res) => { res.writeHead(302, { Location: `${destination.origin}/receive` }); res.end(); });
  const headers = { Authorization: 'synthetic-auth', 'Proxy-Authorization': 'synthetic-proxy', Cookie: 'synthetic-cookie', 'X-Trace': 'ordinary-trace' };
  try {
    const actual = await request(`${source.origin}/redirect`, { headers: representation === 'array' ? Object.entries({ Host: new URL(source.origin).host, ...headers }).flat() : headers });
    for (const name of ['authorization', 'proxy-authorization', 'cookie']) expect(actual[name]).toBeUndefined();
    expect(actual['x-trace']).toBe('ordinary-trace');
  } finally { await close(source.server); await close(destination.server); }
});

test.each(['object', 'array'].flatMap(representation => ['X-Credential^Token', 'X-Credential|Token'].map(name => ({ representation, name }))))('cross-origin redirect treats $name literally in $representation headers', async ({ representation, name }) => {
  const destination = await listen((req, res) => { res.end(JSON.stringify(req.headers)); });
  const source = await listen((_req, res) => { res.writeHead(307, { Location: `${destination.origin}/receive` }); res.end(); });
  try {
    const headers = { Host: new URL(source.origin).host, [name]: 'synthetic-custom-secret', 'X-Trace': 'ordinary-trace' };
    const actual = await request(source.origin, { headers: representation === 'array' ? Object.entries(headers).flat() : headers, sensitiveHeaders: [name] });
    expect(actual[name.toLowerCase()]).toBeUndefined();
    expect(actual['x-trace']).toBe('ordinary-trace');
  } finally { await close(source.server); await close(destination.server); }
});

test.each(['object', 'array'])('same-origin relative redirect retains legitimate %s credentials', async representation => {
  const source = await listen((req, res) => {
    if (req.url === '/start') { res.writeHead(302, { Location: '/receive' }); res.end(); }
    else res.end(JSON.stringify(req.headers));
  });
  const headers = { Authorization: 'synthetic-auth', Cookie: 'synthetic-cookie', 'X-Credential^Token': 'synthetic-custom-secret' };
  try {
    const actual = await request(`${source.origin}/start`, { headers: representation === 'array' ? Object.entries({ Host: new URL(source.origin).host, ...headers }).flat() : headers, sensitiveHeaders: ['X-Credential^Token'] });
    for (const [name, value] of Object.entries(headers)) expect(actual[name.toLowerCase()]).toBe(value);
  } finally { await close(source.server); }
});

test('resolved dependency uses the reviewed minimum patched version', () => {
  expect(require('follow-redirects/package.json').version).toBe('1.16.1');
});

test.each([307, 308])('%i redirect preserves legitimate POST method and body', async status => {
  const destination = await listen((req, res) => {
    let body = ''; req.setEncoding('utf8'); req.on('data', chunk => { body += chunk; });
    req.on('end', () => { res.end(JSON.stringify({ method: req.method, body, trace: req.headers['x-trace'] })); });
  });
  const source = await listen((_req, res) => { res.writeHead(status, { Location: destination.origin }); res.end(); });
  try {
    expect(await request(source.origin, { method: 'POST', body: 'ordinary-request-body', headers: { 'X-Trace': 'ordinary-trace' } }))
      .toEqual({ method: 'POST', body: 'ordinary-request-body', trace: 'ordinary-trace' });
  } finally { await close(source.server); await close(destination.server); }
});
