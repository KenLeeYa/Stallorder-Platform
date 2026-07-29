import { NextResponse } from "next/server";

export async function readJson(
  request: Request,
  requestId?: string,
  options: { maxBytes?: number } = {},
) {
  const headers = requestId ? { "x-request-id": requestId } : undefined;
  const maxBytes = Math.max(1, Math.min(options.maxBytes ?? 32_000, 1_000_000));
  const contentType = request.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
  const contentLength = Number(request.headers.get("content-length") ?? 0);

  if (contentType !== "application/json") {
    return {
      error: NextResponse.json(
        { error: "Content-Type 必須為 application/json。" },
        { status: 415, headers },
      ),
    };
  }

  if (contentLength > maxBytes) {
    return { error: NextResponse.json({ error: "請求內容過大。" }, { status: 413, headers }) };
  }

  try {
    if (!request.body) throw new Error("missing body");
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        return { error: NextResponse.json({ error: "請求內容過大。" }, { status: 413, headers }) };
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(received);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { data: JSON.parse(text) };
  } catch {
    return { error: NextResponse.json({ error: "JSON 格式不正確。" }, { status: 400, headers }) };
  }
}
