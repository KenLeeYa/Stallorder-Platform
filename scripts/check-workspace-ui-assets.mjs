// Deployment regression: a correct source SHA can still restore stale compiled CSS.
// Run against the real test hostname after deployment; does not replace browser QA.
// Usage: node scripts/check-workspace-ui-assets.mjs https://test.example/mini
// A direct immutable .css URL can reproduce a known stale artifact.
const page = new URL(process.argv[2]);
if (page.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(page.hostname)) {
  throw new Error("HTTPS_OR_LOOPBACK_REQUIRED");
}
async function get(url) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`HTTP_${response.status}`);
  return response.text();
}
const document = await get(page);
const urls = page.pathname.endsWith(".css") ? [page] : [...new Set(
  [...document.matchAll(/href="([^"]+\.css(?:\?[^"]*)?)"/g)].map(match => match[1]),
)].map(value => new URL(value, page));
if (!urls.length || urls.some(url => url.origin !== page.origin)) throw new Error("SAME_ORIGIN_STYLES_REQUIRED");
let css = "";
for (const url of urls) css += page.pathname.endsWith(".css") ? document : await get(url);
const checks = ["workspace-responsive-navigation", "workspace-toolbar-function", "workspace-all-functions"]
  .map(selector => ({ selector, present: css.includes(`.${selector}`) }));
const pass = checks.every(check => check.present);
console.log(JSON.stringify({ origin: page.origin, stylesheets: urls.map(url => url.pathname), checks, pass }));
if (!pass) process.exitCode = 1;
