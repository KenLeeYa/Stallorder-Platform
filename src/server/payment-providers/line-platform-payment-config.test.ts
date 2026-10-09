import { describe, expect, it } from "vitest";
import { paymentRuntime, resolvePaymentCredential } from "./line-platform-payment-config";
import { platformDatabaseFingerprint } from "@/server/line-platform/runtime";

const env = { LINE_PLATFORM_ENABLED: "true", LINE_PLATFORM_PAY_ENABLED: "true", LINE_PLATFORM_ENVIRONMENT: "local", LINE_PLATFORM_PAY_CALLBACK_ORIGIN: "https://qa.example.test", LINE_PLATFORM_PAY_STATE_SECRET: "synthetic-test-key-32-characters-long" };
describe("platform payment configuration", () => {
  it("keeps new payments off while permitting recovery after the new-payment stop switch", () => {
    expect(() => paymentRuntime(true, { ...env, LINE_PLATFORM_PAY_ENABLED: "false" })).toThrow("LINE_PAY_NEW_PAYMENTS_DISABLED");
    expect(paymentRuntime(false, { ...env, LINE_PLATFORM_PAY_ENABLED: "false" }).environment).toBe("local");
    expect(() => paymentRuntime(false, { ...env, VERCEL_ENV: "production" })).toThrow("LINE_PAY_SANDBOX_ONLY");
  });
  it("rejects a credential whose merchant or immutable version differs from its snapshot", () => {
    const snapshot = { credentialReference: "env://LINE_PAY_TEST_V1", credentialVersion: "v1", merchantReference: "merchant-a", channelId: "12345" };
    const credential = { channelId: "12345", channelSecret: "synthetic", merchantReference: "merchant-a", version: "v1", environment: "SANDBOX" };
    expect(resolvePaymentCredential(snapshot, { LINE_PAY_TEST_V1: JSON.stringify(credential) }).channelId).toBe("12345");
    expect(() => resolvePaymentCredential(snapshot, { LINE_PAY_TEST_V1: JSON.stringify({ ...credential, merchantReference: "merchant-b" }) })).toThrow("LINE_PAY_CREDENTIAL_MISMATCH");
    expect(() => resolvePaymentCredential(snapshot, { LINE_PAY_TEST_V1: JSON.stringify({ ...credential, environment: "LIVE" }) })).toThrow("LINE_PAY_CREDENTIAL_MISMATCH");
  });
  it("rejects preview when its actual database differs from the independently bound target",()=>{
    const preview="postgresql://fixture_preview:synthetic@db.example.test:5432/preview";
    const binding=JSON.stringify({environment:"preview",fingerprint:platformDatabaseFingerprint(preview)});
    const input={...env,VERCEL_ENV:"preview",LINE_PLATFORM_ENVIRONMENT:"preview",LINE_PLATFORM_DATABASE_BINDING_JSON:binding,DATABASE_URL:preview};
    expect(paymentRuntime(false,input).environment).toBe("preview");
    expect(()=>paymentRuntime(false,{...input,DATABASE_URL:"postgresql://fixture_production:synthetic@db.example.test:5432/production"})).toThrow("LINE_PLATFORM_DATABASE_MISMATCH");
  });
});
