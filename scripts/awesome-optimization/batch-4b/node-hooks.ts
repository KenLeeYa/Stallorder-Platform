// Test runtime is Node 24; installed application Node typings predate this API.
import * as nodeModule from "node:module";

type ResolveContext = { parentURL?: string; conditions?: readonly string[]; importAttributes?: Record<string, string> };
type ResolveResult = { url: string; format?: string; shortCircuit?: boolean };
type Resolve = (specifier: string, context: ResolveContext) => ResolveResult;
type RegisterHooks = (hooks: { resolve: (specifier: string, context: ResolveContext, nextResolve: Resolve) => ResolveResult }) => { deregister(): void };
const actual = (nodeModule as typeof nodeModule & { registerHooks?: RegisterHooks }).registerHooks;
if (typeof actual !== "function") throw new Error("B4B_NODE24_REGISTER_HOOKS_REQUIRED");
export const registerHooks: RegisterHooks = actual;
