"use client";
import liff from "@line/liff/core";
import Login from "@line/liff/login";
import IsLoggedIn from "@line/liff/is-logged-in";
import GetIDToken from "@line/liff/get-id-token";

// Load only login APIs; no analytics, profile collection or messaging plugins.
liff.use(new Login()).use(new IsLoggedIn()).use(new GetIDToken());
let initialization: { id: string; promise: ReturnType<typeof liff.init> } | undefined;
export function initializeMiniApp(liffId: string) {
  if (initialization?.id === liffId) return initialization.promise;
  const promise = liff.init({ liffId });
  initialization = { id: liffId, promise };
  void promise.catch(() => { if (initialization?.promise === promise) initialization = undefined; });
  return promise;
}
export default liff;
