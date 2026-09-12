const updateMessage = "通知服務尚未更新。請先完成畫面上的系統更新；若沒有更新提示，關閉此網站的所有分頁後重新開啟，再測試鎖屏通知。";

// Check the active worker, not the downloaded/waiting version. Never bypass offline update safety.
export async function verifyStaffPushWorker(registration: ServiceWorkerRegistration) {
  if (!registration.active) throw new Error(updateMessage);
  const active = registration.active;
  await new Promise<void>((resolve, reject) => {
    const channel = new MessageChannel();
    const close = () => { channel.port1.close(); channel.port2.close(); };
    const timer = setTimeout(() => { close(); reject(new Error(updateMessage)); }, 3000);
    channel.port1.onmessage = event => {
      clearTimeout(timer); close();
      if (event.data?.supported === true && event.data.silent === false) resolve();
      else reject(new Error(updateMessage));
    };
    try { active.postMessage({ type: "STAFF_PUSH_CAPABILITY" }, [channel.port2]); }
    catch (error) { clearTimeout(timer); close(); reject(error); }
  });
}
