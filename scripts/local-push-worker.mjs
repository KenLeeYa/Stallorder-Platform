// Load environment in the QA launcher, never pass credentials on the command line.
const origin = process.env.NEXT_PUBLIC_APP_URL;
const database = new URL(process.env.DATABASE_URL ?? "file:///");
if (process.env.NODE_ENV !== "development" || process.env.WEB_PUSH_ENABLED !== "true"
  || origin !== "http://127.0.0.1:3018" || database.hostname !== "127.0.0.1"
  || database.port !== "55722" || !process.env.CRON_SECRET) throw new Error("LOCAL_PUSH_TARGET_MISMATCH");
let stopped = false;
process.on("SIGTERM", () => { stopped = true; });
process.on("SIGINT", () => { stopped = true; });
while (!stopped) {
  try {
    const response = await fetch(origin + "/api/cron/staff-push", {
      headers: { authorization: "Bearer " + process.env.CRON_SECRET },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) console.log("PUSH_WORKER_HTTP", response.status);
    else {
      const body = await response.json();
      if (body.results?.length) console.log(JSON.stringify({ at: new Date().toISOString(), ...body }));
    }
  } catch { console.log("PUSH_WORKER_CONNECTION_UNAVAILABLE"); }
  await new Promise(resolve => setTimeout(resolve, 5_000));
}
