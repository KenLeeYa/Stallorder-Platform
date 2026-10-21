import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, "..");
const lock = JSON.parse(readFileSync(path.join(root, "package-lock.json"), "utf8"));
const pluginRequire = createRequire(require.resolve("@next/eslint-plugin-next"));
const { getRootDirs } = pluginRequire("./utils/get-root-dirs.js");

describe("security dependency release contract", () => {
  it("removes the unpatched braces implementation from the installed graph", () => {
    expect(Object.keys(lock.packages).filter((key) => /node_modules\/(braces|micromatch)$/.test(key))).toEqual([]);
    expect(pluginRequire("fast-glob/package.json").name).toBe("@stallorder/next-root-glob");
    expect(Object.entries(lock.packages).filter(([key, value]) => key && value.dependencies?.["fast-glob"]).map(([key]) => key)).toEqual(["node_modules/@next/eslint-plugin-next"]);
  });

  it.each([
    ["next", "16.3.8"],
    ["sharp", "0.35.5"],
    ["brace-expansion", "5.0.12"],
    ["shell-quote", "1.11.0"],
    ["undici", "7.29.1"],
    ["source-map-js", "1.2.2"],
    ["vite", "8.2.4"],
  ])("locks %s to its reviewed security release", (name, version) => {
    expect(lock.packages[`node_modules/${name}`].version).toBe(version);
  });

  it("rejects shell comment terminator injection instead of emitting a command", () => {
    expect(() => require("shell-quote").quote(["echo", "ok", { comment: "x" }, "a\nid;#"])).toThrow(TypeError);
  });

  it("loads the patched native image pipeline after script-disabled installation", async () => {
    const sharp = require("sharp");
    const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"><rect width="2" height="2" fill="red"/></svg>')).png().toBuffer();
    expect(await sharp(image).metadata()).toMatchObject({ width: 2, height: 2, format: "png" });
  });

  it("keeps dependency lifecycle scripts denied at the repository boundary", () => {
    expect(readFileSync(path.join(root, ".npmrc"), "utf8")).toMatch(/^ignore-scripts=true$/m);
  });
});

describe("Next lint root discovery compatibility", () => {
  const roots = (rootDir) => getRootDirs({ cwd: root, settings: { next: { rootDir } } }).sort();

  it("keeps the default Next app root without scanning children", () => {
    expect(getRootDirs({ cwd: root, settings: {} })).toEqual([root]);
  });

  it.each([
    ["src", ["src"]],
    ["src/app", ["src/app"]],
    ["src/{app,lib}", ["src/app", "src/lib"]],
    ["src/*", ["src/app", "src/components", "src/lib", "src/offline", "src/server", "src/test"]],
    ["src/nonexistent-root", []],
    [["src/app", "src/lib"], ["src/app", "src/lib"]],
  ])("discovers only requested directory roots: %s", (pattern, expected) => {
    expect(roots(pattern)).toEqual(expected);
  });

  it("preserves absolute paths and Windows separators", () => {
    expect(roots(path.join(root, "src", "app"))).toEqual([path.join(root, "src", "app").replaceAll("\\", "/")]);
  });

  it("rejects deeply nested patterns without recursive stack exhaustion", () => {
    expect(() => roots("{".repeat(3000) + "a,b" + "}".repeat(3000))).toThrow(/Next root glob exceeds the supported complexity/);
  });

  it("retains the Next security and accessibility lint rules", async () => {
    const { ESLint } = await import("eslint");
    const engine = new ESLint({ cwd: root });
    const [result] = await engine.lintText('export default function Page() { return <><head /><img src="/photo.png" /></>; }', { filePath: "src/pages/dependency-security-fixture.tsx" });
    expect(result.messages.map((message) => message.ruleId)).toEqual(expect.arrayContaining(["@next/next/no-head-element", "@next/next/no-img-element", "jsx-a11y/alt-text"]));
  }, 15000);
});
