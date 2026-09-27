import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--file") {
  console.error("用法：node scripts/check-line-test-settings.mjs --file <安全設定檔路徑>");
  process.exitCode = 1;
} else {
  try {
    const settings = JSON.parse(readFileSync(resolve(args[1]), "utf8").replace(/^\uFEFF/, ""));
    const checks = {
      "設定格式": settings.version === 1,
      "MINI Provider ID": /^\d{1,30}$/.test(settings.miniApp?.providerId ?? ""),
      "MINI developing Channel ID": /^\d{1,30}$/.test(settings.miniApp?.developingChannelId ?? ""),
      "MINI developing LIFF ID": /^\d+-[A-Za-z0-9]+$/.test(settings.miniApp?.developingLiffId ?? ""),
      "LINE Pay 國家與類型": settings.linePaySandbox?.country === "TW" && settings.linePaySandbox?.apiType === "ONLINE",
      "LINE Pay Channel ID": /^\d{1,30}$/.test(settings.linePaySandbox?.channelId ?? ""),
      "LINE Pay Secret": typeof settings.linePaySandbox?.channelSecret === "string" && settings.linePaySandbox.channelSecret.trim().length >= 16,
    };
    for (const [label, valid] of Object.entries(checks)) console.log(`${valid ? "已填" : "待填或格式不符"}：${label}`);
    console.log("此檢查僅讀取本機格式；沒有連線 LINE、建立交易或啟用正式金流。");
    process.exitCode = Object.values(checks).every(Boolean) ? 0 : 2;
  } catch {
    console.error("無法讀取設定檔或 JSON 格式不正確。請檢查檔案；不要在對話貼上檔案內容。");
    process.exitCode = 1;
  }
}
