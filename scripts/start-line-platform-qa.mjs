// Synthetic local UI QA only. Does not provision or call a LINE account.
import { spawn } from "node:child_process";
import { loadEnvFile } from "node:process";
import { resolve } from "node:path";
import { buildLocalQaEnvironment } from "./local-qa-runtime.mjs";

loadEnvFile(".env.local");
loadEnvFile("supabase/functions/e2e-runtime.defaults");
const database = new URL(process.env.DATABASE_URL);
if (!["localhost", "127.0.0.1"].includes(database.hostname)
  || database.pathname !== "/stallorder_line_miniapp_20260926" || database.port !== "55722") throw new Error("LINE_QA_DATABASE_REJECTED");
const origin = "https://127.0.0.1:3024";
const env = {
  ...buildLocalQaEnvironment(3024), APP_ENV: "local", VERCEL_ENV: "",
  APP_BASE_URL: origin, NEXT_PUBLIC_APP_URL: origin, PUBLIC_ORDER_FUNCTION_ORIGIN: origin, LOCAL_DEV_ALLOWED_ORIGINS: origin,
  LINE_PLATFORM_ENABLED: "true", LINE_PLATFORM_ENVIRONMENT: "local", LINE_PLATFORM_NOTIFICATIONS_ENABLED: "false",
  LINE_PLATFORM_PICKUP_ENABLED: "true", LINE_PLATFORM_PAY_ENABLED: "false",
  LINE_PLATFORM_DATA_KEY: Buffer.alloc(32,47).toString("base64"),
  LINE_PLATFORM_BINDING_JSON: JSON.stringify({ environment:"local",providerId:"1234567",channelId:"1234568",liffId:"1234568-fixture",
    internalChannel:"developing",endpointUrl:`${origin}/mini`,oaDestination:`U${"a".repeat(32)}`,oaChannelId:"1234569",
    oaAccessTokenReference:"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",oaSecretReference:"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",termsVersion:"test-v1" }),
};
const child = spawn(process.execPath, [resolve("node_modules/next/dist/bin/next"),"dev","--webpack","--hostname","127.0.0.1","-p","3024",
  "--experimental-https","--experimental-https-key",resolve(".secrets/line-qa-key.pem"),"--experimental-https-cert",resolve(".secrets/line-qa-cert.pem")],
  {env,stdio:"inherit",windowsHide:true});
console.log(`SYNTHETIC LINE UI QA: ${origin}/mini; original manual QA 3023 is unchanged.`);
child.on("exit",code=>{process.exitCode=code??1;});
