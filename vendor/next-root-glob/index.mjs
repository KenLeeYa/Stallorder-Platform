// Only @next/eslint-plugin-next's getRootDirs uses this adapter (globSync + onlyDirectories).
// Replace the unpatched braces dependency, not Next's lint rules or audit policy.
import { isAbsolute } from "node:path";
import { globSync as tinyGlobSync } from "tinyglobby";

export const globSync = (pattern, options) => {
  if (typeof pattern !== "string" || options?.onlyDirectories !== true) {
    throw new TypeError("Unsupported Next root glob contract");
  }
  let depth = 0;
  for (const character of pattern) {
    if (character === "{") depth += 1;
    if (character === "}") depth = Math.max(0, depth - 1);
    if (pattern.length > 4096 || depth > 32) {
      throw new RangeError("Next root glob exceeds the supported complexity");
    }
  }
  return tinyGlobSync(pattern, {
    ...options,
    expandDirectories: false,
    absolute: isAbsolute(pattern),
  }).map((directory) => directory === "/" || /^[A-Za-z]:\/$/.test(directory) ? directory : directory.replace(/\/$/, ""));
};
