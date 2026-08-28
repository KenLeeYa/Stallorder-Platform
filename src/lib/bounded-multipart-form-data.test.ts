import { describe, expect, it } from "vitest";
import { readBoundedMultipartFormData } from "./bounded-multipart-form-data";

describe("bounded multipart form data", () => {
  it("parses a valid multipart body under the byte budget", async () => {
    const source = new FormData();
    source.set("name", "餐點圖片");
    source.set("image", new File([new Uint8Array([1, 2, 3])], "menu.png", { type: "image/png" }));
    const request = new Request("https://example.test/upload", { method: "POST", body: source });

    const parsed = await readBoundedMultipartFormData(request, 4_096);

    expect(parsed.get("name")).toBe("餐點圖片");
    expect(parsed.get("image")).toBeInstanceOf(File);
  });

  it("rejects an oversized declared body before reading the stream", async () => {
    let pulls = 0;
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test-boundary",
        "content-length": "101",
      },
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pulls += 1;
          controller.close();
        },
      }, { highWaterMark: 0 }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedMultipartFormData(request, 100)).rejects.toMatchObject({
      reason: "BODY_TOO_LARGE",
    });
    expect(pulls).toBe(0);
  });

  it("rejects an actual body that exceeds a falsely small declared length", async () => {
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: {
        "content-type": "multipart/form-data; boundary=test-boundary",
        "content-length": "10",
      },
      body: new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new Uint8Array(101));
          controller.close();
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedMultipartFormData(request, 100)).rejects.toMatchObject({
      reason: "BODY_TOO_LARGE",
    });
  });

  it("cancels a stalled multipart body at the total deadline", async () => {
    let cancelled = false;
    const request = new Request("https://example.test/upload", {
      method: "POST",
      headers: { "content-type": "multipart/form-data; boundary=test-boundary" },
      body: new ReadableStream<Uint8Array>({
        pull() {
          return new Promise<void>(() => undefined);
        },
        cancel() {
          cancelled = true;
        },
      }),
      duplex: "half",
    } as RequestInit & { duplex: "half" });

    await expect(readBoundedMultipartFormData(request, 100, 20)).rejects.toMatchObject({
      reason: "READ_TIMEOUT",
    });
    expect(cancelled).toBe(true);
  });
});
