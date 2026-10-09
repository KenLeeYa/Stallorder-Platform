import { expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import vm from 'node:vm';
import ts from 'typescript';
import { fetchDrProvider } from './lib/dr-operator-io.mjs';

test('actual DR Access readback rejects redirects before reading destinations', async () => {
  const source = readFileSync(new URL('./manage-dr-operator-entry.mjs', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('operator.mjs', source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'readCloudflareAccessState');
  expect(declaration).toBeDefined();
  let destinationRequests = 0;
  let guardedRequests = 0;
  const server = createServer((request, response) => {
    if (request.url === '/destination') { destinationRequests++; response.end('unexpected'); }
    else { response.writeHead(302, { location: '/destination' }); response.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const localUrl = `http://127.0.0.1:${server.address().port}/redirect`;
    const context = vm.createContext({ AbortSignal, cloudflareAccountId: 'synthetic-account',
      cloudflareHeaders: () => ({ authorization: 'Bearer synthetic-test-only' }),
      fetch: () => { throw Error('RAW_FETCH_BYPASSED_REDIRECT_GUARD'); },
      fetchDrProvider: (url, init) => {
        guardedRequests++;
        expect(url).toBe('https://api.cloudflare.com/client/v4/accounts/synthetic-account/access/apps?per_page=1000');
        return fetchDrProvider(url, init, (_url, request) => fetch(localUrl, request));
      },
    });
    const readback = vm.runInContext(`(${declaration.getText(ast)})`, context);
    await expect(readback()).rejects.toThrow();
    expect(guardedRequests).toBe(1);
    expect(destinationRequests).toBe(0);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
});
