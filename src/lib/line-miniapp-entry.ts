// Let the SDK consume primary-redirect parameters before navigation can change them.
export async function initializeMiniAppEntry(liffId: string, search: string) {
  if (!new URLSearchParams(search).has("liff.state")) return;
  const { initializeMiniApp } = await import("./line-miniapp-liff");
  await initializeMiniApp(liffId);
}
