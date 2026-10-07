import { mkdir, open } from "node:fs/promises";
import path from "node:path";

export function fetchDrProvider(url, init, fetchImpl = fetch) {
  return fetchImpl(url, { ...init, redirect: "error", signal: AbortSignal.timeout(30_000) });
}

export async function withReservedDrEvidence(evidencePath, operation) {
  const handle = await reserveDrEvidence(evidencePath);
  let operationFailed = false;
  try {
    return await operation(handle);
  } catch (error) {
    operationFailed = true;
    throw error;
  } finally {
    if (operationFailed) await handle?.close().catch(() => {});
    else await handle?.close();
  }
}

export async function reserveDrEvidence(evidencePath) {
  if (!evidencePath) return;
  await mkdir(path.dirname(evidencePath), { recursive: true });
  return open(evidencePath, "wx", 0o600);
}

export async function writeDrEvidence(destination, evidence) {
  if (!destination) return;
  if (typeof destination === "string") {
    return withReservedDrEvidence(destination, handle => writeDrEvidence(handle, evidence));
  }
  const bytes = Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`, "utf8");
  let position = 0;
  while (position < bytes.length) {
    const { bytesWritten } = await destination.write(bytes, position, bytes.length - position, position);
    if (bytesWritten === 0) throw new Error("DR_EVIDENCE_WRITE_STALLED");
    position += bytesWritten;
  }
  await destination.truncate(bytes.length);
}

// Recording a failure must not replace the operation's original error.
export async function writeDrFailureEvidence(evidencePath, evidence, originalError) {
  try {
    await writeDrEvidence(evidencePath, evidence);
  } catch {
    if (originalError instanceof Error) originalError.evidenceWriteFailed = true;
  }
}
