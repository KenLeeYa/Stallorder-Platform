export type BoundedTextReadFailureReason =
  | "INVALID_CONTENT_LENGTH"
  | "BODY_TOO_LARGE"
  | "READ_FAILED";

export class BoundedTextReadError extends Error {
  constructor(readonly reason: BoundedTextReadFailureReason) {
    super(reason);
    this.name = "BoundedTextReadError";
  }
}

export async function readBoundedText(
  input: { body: ReadableStream<Uint8Array> | null; headers: Headers },
  maxBytes: number,
) {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new TypeError("maxBytes must be a positive safe integer");
  }
  const declaredLength = input.headers.get("content-length");
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength)) {
      throw new BoundedTextReadError("INVALID_CONTENT_LENGTH");
    }
    const declaredBytes = Number(declaredLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      throw new BoundedTextReadError("BODY_TOO_LARGE");
    }
  }
  if (!input.body) return "";

  const reader = input.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) return text + decoder.decode();
      bytesRead += result.value.byteLength;
      if (bytesRead > maxBytes) {
        await cancelReader(reader);
        throw new BoundedTextReadError("BODY_TOO_LARGE");
      }
      text += decoder.decode(result.value, { stream: true });
    }
  } catch (error) {
    if (error instanceof BoundedTextReadError) throw error;
    await cancelReader(reader);
    throw new BoundedTextReadError("READ_FAILED");
  } finally {
    reader.releaseLock();
  }
}

async function cancelReader(reader: ReadableStreamDefaultReader<Uint8Array>) {
  try {
    await reader.cancel();
  } catch {
    // The bounded read result must not depend on provider stream cleanup behavior.
  }
}
