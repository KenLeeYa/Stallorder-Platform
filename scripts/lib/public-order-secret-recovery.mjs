// This handler is embedded into a short-lived, JWT-protected recovery function.
export function createPublicOrderSecretRecoveryHandler(config, { getEnv, now = Date.now, crypto = globalThis.crypto }) {
  const encoder = new TextEncoder();
  const names = ["ABUSE_HASH_SECRET", "TOKEN_DERIVATION_SECRET"];
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const hash = async (value) => hex(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
  const base64 = (buffer) => btoa(String.fromCharCode(...new Uint8Array(buffer)));
  const deny = () => new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  return async (request) => {
    if (request.method !== "POST" || now() < config.createdAt || now() >= config.expiresAt
      || config.expiresAt - config.createdAt > 300_000
      || getEnv("SUPABASE_URL") !== `https://${config.projectRef}.supabase.co`) return deny();
    const serviceKey = getEnv("SUPABASE_SERVICE_ROLE_KEY");
    const authorization = request.headers.get("authorization") ?? "";
    const nonce = request.headers.get("x-recovery-nonce") ?? "";
    if (!serviceKey || authorization.length > 4096 || nonce.length !== 64
      || await hash(authorization) !== await hash(`Bearer ${serviceKey}`)
      || await hash(nonce) !== config.nonceHash) return deny();
    try {
      const values = {};
      for (const name of names) {
        const value = getEnv(name);
        if (!value || await hash(value) !== config.digests[name]) return deny();
        values[name] = value;
      }
      const recipient = await crypto.subtle.importKey("spki",
        Uint8Array.from(atob(config.recipientPublicKey), (character) => character.charCodeAt(0)),
        { name: "RSA-OAEP", hash: "SHA-256" }, false, ["encrypt"]);
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, ["encrypt"]);
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv,
        additionalData: encoder.encode(`${config.projectRef}:${config.recoveryId}`) }, key,
        encoder.encode(JSON.stringify(values)));
      const wrappedKey = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, recipient,
        await crypto.subtle.exportKey("raw", key));
      return Response.json({ schemaVersion: 1, projectRef: config.projectRef, recoveryId: config.recoveryId,
        iv: base64(iv), ciphertext: base64(ciphertext), wrappedKey: base64(wrappedKey) },
      { headers: { "Cache-Control": "no-store" } });
    } catch {
      return new Response(null, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}
