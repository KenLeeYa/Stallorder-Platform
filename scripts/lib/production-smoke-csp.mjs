const turnstileOrigin = "https://challenges.cloudflare.com";

export function allowsTurnstileCsp(policy) {
  if (typeof policy !== "string" || !policy.trim() || /[,\r\n]/.test(policy)) return false;
  const directives = new Map();
  for (const part of policy.split(";")) {
    const tokens = part.trim().split(/\s+/);
    if (!tokens[0]) continue;
    const name = tokens.shift().toLowerCase();
    if (!/^[a-z][a-z0-9-]*$/.test(name) || directives.has(name)) return false;
    directives.set(name, tokens);
  }
  const script = directives.get("script-src-elem") ?? directives.get("script-src") ?? directives.get("default-src") ?? [];
  const frame = directives.get("frame-src") ?? directives.get("child-src") ?? directives.get("default-src") ?? [];
  const exactOrigin = tokens => tokens.some(token => [turnstileOrigin, `${turnstileOrigin}/`].includes(token.toLowerCase()));
  // With a nonce/hash, strict-dynamic ignores host allowlists in modern browsers.
  if (script.some(token => token.toLowerCase() === "'strict-dynamic'") && script.some(token => /^'(?:nonce-|sha(?:256|384|512)-)/i.test(token))) return false;
  return exactOrigin(script) && exactOrigin(frame);
}
