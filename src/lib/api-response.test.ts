import { describe, expect, it } from "vitest";
import { readApiJson } from "@/lib/api-response";

describe("readApiJson", () => {
  it("解析正常 JSON 回應", async () => {
    const payload = await readApiJson<{ ok: boolean }>(
      Response.json({ ok: true }),
      "操作失敗。",
    );

    expect(payload).toEqual({ ok: true });
  });

  it("HTML 錯誤頁不會把原始解析錯誤顯示給使用者", async () => {
    const response = new Response("<!DOCTYPE html><title>Error</title>", {
      status: 502,
      headers: { "content-type": "text/html", "x-request-id": "request-123" },
    });

    await expect(readApiJson(response, "圖片上傳失敗。")).rejects.toThrow(
      "圖片上傳失敗。（HTTP 502，追蹤編號 request-123）",
    );
  });

  it("空白錯誤回應會轉成可理解的訊息", async () => {
    const response = new Response(null, { status: 500 });

    await expect(readApiJson(response, "付款方式更新失敗。")).rejects.toThrow(
      "付款方式更新失敗。（HTTP 500）",
    );
  });
});
