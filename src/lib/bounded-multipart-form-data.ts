export type BoundedMultipartFailureReason =
  | "INVALID_CONTENT_TYPE"
  | "INVALID_CONTENT_LENGTH"
  | "BODY_TOO_LARGE"
  | "READ_TIMEOUT"
  | "PARSE_FAILED";

export class BoundedMultipartError extends Error {
  constructor(readonly reason: BoundedMultipartFailureReason) {
    super(reason);
    this.name = "BoundedMultipartError";
  }
}

export async function readBoundedMultipartFormData(
  input: { body: ReadableStream<Uint8Array> | null; headers: Headers },
  maxBytes: number,
  timeoutMs = 30_000,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive safe integer");
  }
  const contentType = input.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw new BoundedMultipartError("INVALID_CONTENT_TYPE");
  }
  const declaredLength = input.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new BoundedMultipartError("INVALID_CONTENT_LENGTH");
    }
    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      throw new BoundedMultipartError("BODY_TOO_LARGE");
    }
  }
  if (!input.body) throw new BoundedMultipartError("PARSE_FAILED");

  const reader = input.body.getReader();
  const deadlineAt = Date.now() + timeoutMs;
  let bytesRead = 0;
  let failure: BoundedMultipartError | null = null;
  const boundedBody = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const result = await readBeforeDeadline(reader, deadlineAt);
        if (result.done) {
          controller.close();
          return;
        }
        bytesRead += result.value.byteLength;
        if (bytesRead > maxBytes) {
          failure = new BoundedMultipartError("BODY_TOO_LARGE");
          await cancelReader(reader);
          controller.error(failure);
          return;
        }
        controller.enqueue(result.value);
      } catch (error) {
        failure = error instanceof BoundedMultipartError
          ? error
          : new BoundedMultipartError("PARSE_FAILED");
        await cancelReader(reader);
        controller.error(failure);
      }
    },
    async cancel() {
      await cancelReader(reader);
    },
  });

  try {
    return await new Response(boundedBody, {
      headers: { "content-type": contentType },
    }).formData();
  } catch {
    throw failure ?? new BoundedMultipartError("PARSE_FAILED");
  } finally {
    reader.releaseLock();
  }
}

async function readBeforeDeadline(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  deadlineAt: number,
) {
  const remainingMs = deadlineAt - Date.now();
  if (remainingMs <= 0) throw new BoundedMultipartError("READ_TIMEOUT");
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      reader.read(),
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(
          () => reject(new BoundedMultipartError("READ_TIMEOUT")),
          remainingMs,
        );
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // Cleanup failures must not change the bounded read result.
  }
}
