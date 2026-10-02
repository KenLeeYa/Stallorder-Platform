# Bounded dependency compatibility regression

Run from the repository root with Node 24 and the current exact lock:

```powershell
node scripts/awesome-optimization/security-patch/dependency-regression.mjs
node scripts/awesome-optimization/security-patch/runtime-regression.mjs
```

The first command resolves minimatch, brace-expansion and undici from each actual caller. It checks legacy callable/constructor and modern exports, patterns, normal expansion, and the actual flat ESLint config on TS/TSX and ignored outputs.

The second command starts only disposable ephemeral loopback HTTP/proxy and Miniflare fixtures. It exercises Actions' real `getAgentDispatcher`/ProxyAgent and HttpClient success/failure without credentials, Miniflare fetch/Headers/Request/Response, upstream error/redirect/network failure, websocket echo/close, and closes its workers/listeners/sockets in `finally`. Actions always bypasses literal loopback hostnames, so the logical `security-patch.invalid` CONNECT target is accepted only by this explicit loopback proxy and mapped directly to its exact 127.0.0.1 fixture port; no DNS lookup or external connection is used. It changes proxy environment variables only within its child process and restores them. No account, provider request, database, production service or deployment is used.

Actions 2.2.3 declares undici ^5.25.4. The installed 7.29.1 is an inherited, explicit compatibility exception requiring these controls, not an in-range resolution. Miniflare's declared exact 7.28.0 is also deliberately overridden. Tests do not replace the full lock audit, actual web login/order QA or independent review.
