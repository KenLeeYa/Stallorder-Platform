"use client";

import { useSyncExternalStore } from "react";

const subscribe = () => () => undefined;
const clientSnapshot = () => true;
const serverSnapshot = () => false;

/** Keep server-rendered controls disabled until their handlers are attached. */
export function useClientReady() {
  return useSyncExternalStore(subscribe, clientSnapshot, serverSnapshot);
}
