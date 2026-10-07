import { afterEach, describe, expect, it } from "vitest";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { fetchDrProvider, withReservedDrEvidence, writeDrEvidence, writeDrFailureEvidence } from "./dr-operator-io.mjs";

const directories = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});
async function receiptPath() {
  const directory = await mkdtemp(path.join(tmpdir(), "stallorder-dr-io-"));
  directories.push(directory);
  return path.join(directory, "receipt.json");
}

describe("DR provider and evidence boundaries", () => {
  it("writes all UTF-8 bytes when the reserved handle accepts short writes", async () => {
    const output = await receiptPath();
    const evidence = { completed: true, note: "攤點通" };
    await withReservedDrEvidence(output, async handle => {
      const write = handle.write.bind(handle);
      handle.write = (buffer, offset, length, position) => write(buffer, offset, Math.min(3, length), position);
      await writeDrEvidence(handle, evidence);
    });
    expect(await readFile(output, "utf8")).toBe(`${JSON.stringify(evidence, null, 2)}\n`);
  });
  it("fails closed on a zero-byte write and preserves the original remote failure", async () => {
    const output = await receiptPath();
    const original = new Error("DR_REMOTE_FAILURE");
    await expect(withReservedDrEvidence(output, async handle => {
      handle.write = async () => ({ bytesWritten: 0 });
      await expect(writeDrEvidence(handle, { completed: true })).rejects.toThrow("DR_EVIDENCE_WRITE_STALLED");
      await writeDrFailureEvidence(handle, { completed: false }, original);
      throw original;
    })).rejects.toBe(original);
    expect(original.evidenceWriteFailed).toBe(true);
  });
  it("refuses an existing receipt before invoking a remote mutation", async () => {
    const output = await receiptPath();
    await writeFile(output, "existing");
    let mutations = 0;
    await expect(withReservedDrEvidence(output, async () => { mutations++; })).rejects.toMatchObject({ code: "EEXIST" });
    expect(mutations).toBe(0);
    expect(await readFile(output, "utf8")).toBe("existing");
  });
  it("allows only the reservation winner to mutate and records failure on the same handle", async () => {
    const output = await receiptPath();
    let mutations = 0;
    const operation = handle => { mutations++; return writeDrEvidence(handle, { completed: true }); };
    const results = await Promise.allSettled([withReservedDrEvidence(output, operation), withReservedDrEvidence(output, operation)]);
    expect(mutations).toBe(1);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    const failureOutput = `${output}.failed`;
    const original = new Error("DR_REMOTE_FAILURE");
    await expect(withReservedDrEvidence(failureOutput, async handle => {
      await writeDrFailureEvidence(handle, { completed: false }, original);
      throw original;
    })).rejects.toBe(original);
    expect(JSON.parse(await readFile(failureOutput, "utf8"))).toEqual({ completed: false });
  });
  it.each(["vercel", "cloudflare"])("rejects a real %s redirect without requesting its destination", async provider => {
    let destinationRequests = 0;
    const server = createServer((request, response) => {
      if (request.url === "/destination") { destinationRequests++; response.end("unexpected"); }
      else if (request.url === "/success") { response.setHeader("content-type", "application/json"); response.end('{"success":true}'); }
      else { response.writeHead(302, { location: "/destination" }); response.end(); }
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    try {
      await expect(fetchDrProvider(`${origin}/${provider}`, { redirect: "follow", headers: { authorization: "Bearer synthetic-test-only" } })).rejects.toThrow();
      expect(destinationRequests).toBe(0);
      expect(await (await fetchDrProvider(`${origin}/success`, {})).json()).toEqual({ success: true });
    } finally {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  });
  it("creates new evidence and refuses to overwrite existing bytes", async () => {
    const output = await receiptPath();
    await writeDrEvidence(output, { completed: true });
    const before = await readFile(output, "utf8");
    await expect(writeDrEvidence(output, { completed: false })).rejects.toMatchObject({ code: "EEXIST" });
    expect(await readFile(output, "utf8")).toBe(before);
  });
  it("does not follow an existing evidence symlink", async () => {
    const output = await receiptPath(), target = `${output}.target`;
    // Windows file symlinks require privileges; a junction exercises the same existing-link refusal.
    const sentinel = process.platform === "win32" ? path.join(target, "sentinel") : target;
    if (process.platform === "win32") await mkdir(target);
    await writeFile(sentinel, "original");
    await symlink(target, output, process.platform === "win32" ? "junction" : "file");
    let mutations = 0;
    await expect(withReservedDrEvidence(output, async () => { mutations++; })).rejects.toMatchObject({ code: "EEXIST" });
    expect(mutations).toBe(0);
    expect(await readFile(sentinel, "utf8")).toBe("original");
  });
  it("allows only one concurrent receipt writer", async () => {
    const output = await receiptPath();
    const results = await Promise.allSettled([writeDrEvidence(output, { writer: 1 }), writeDrEvidence(output, { writer: 2 })]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter(result => result.status === "rejected")).toHaveLength(1);
    expect([1, 2]).toContain(JSON.parse(await readFile(output, "utf8")).writer);
  });
  it("preserves the original operation error when failure evidence cannot be recorded", async () => {
    const output = await receiptPath();
    await writeFile(output, "existing");
    const original = new Error("DR_ORIGINAL_FAILURE");
    await writeDrFailureEvidence(output, { completed: false }, original);
    expect(original.message).toBe("DR_ORIGINAL_FAILURE");
    expect(original.evidenceWriteFailed).toBe(true);
    expect(await readFile(output, "utf8")).toBe("existing");
  });
  it("preserves a remote error if its reserved handle cannot record failure", async () => {
    const output = await receiptPath();
    const original = new Error("DR_REMOTE_FAILURE");
    await expect(withReservedDrEvidence(output, async handle => {
      await handle.close();
      await writeDrFailureEvidence(handle, { completed: false }, original);
      throw original;
    })).rejects.toBe(original);
    expect(original.evidenceWriteFailed).toBe(true);
  });
});
