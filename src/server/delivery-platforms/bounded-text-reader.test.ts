import { describe, expect, it } from "vitest";
import { readBoundedText } from "./bounded-text-reader";

describe("bounded text reader", () => {
  it("preserves UTF-8 text split across stream chunks", async () => {
    const encoded = new TextEncoder().encode("測試餐點");
    const stream = streamFromChunks([
      encoded.slice(0, 1),
      encoded.slice(1, 4),
      encoded.slice(4),
    ]);

    await expect(readBoundedText(new Response(stream.body), encoded.byteLength))
      .resolves.toBe("測試餐點");
  });

  it("cancels a streamed body as soon as the byte limit is exceeded", async () => {
    const stream = streamFromChunks(Array.from(
      { length: 10 },
      () => new Uint8Array(40).fill(65),
    ));

    await expect(readBoundedText(new Response(stream.body), 100)).rejects.toMatchObject({
      reason: "BODY_TOO_LARGE",
    });
    expect(stream.cancelled()).toBe(true);
    expect(stream.pulls()).toBeLessThan(10);
  });

  it("rejects an oversized declared length before consuming the body", async () => {
    const stream = streamFromChunks([new Uint8Array(10).fill(65)], 0);
    const response = new Response(stream.body, {
      headers: { "content-length": "101" },
    });

    await expect(readBoundedText(response, 100)).rejects.toMatchObject({
      reason: "BODY_TOO_LARGE",
    });
    expect(stream.pulls()).toBe(0);
  });

  it("cancels a stalled body when the total read deadline expires", async () => {
    let cancelled = false;
    const response = new Response(new ReadableStream<Uint8Array>({
      pull() {
        return new Promise<void>(() => undefined);
      },
      cancel() {
        cancelled = true;
      },
    }));

    await expect(readBoundedText(response, 100, 20)).rejects.toMatchObject({
      reason: "READ_TIMEOUT",
    });
    expect(cancelled).toBe(true);
  });
});

function streamFromChunks(chunks: Uint8Array[], highWaterMark = 1) {
  let pullCount = 0;
  let wasCancelled = false;
  return {
    body: new ReadableStream<Uint8Array>({
      pull(controller) {
        if (pullCount >= chunks.length) {
          controller.close();
          return;
        }
        controller.enqueue(chunks[pullCount]);
        pullCount += 1;
      },
      cancel() {
        wasCancelled = true;
      },
    }, { highWaterMark }),
    cancelled: () => wasCancelled,
    pulls: () => pullCount,
  };
}
