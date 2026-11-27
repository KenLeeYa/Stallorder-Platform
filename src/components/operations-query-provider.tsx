"use client";

import { createContext, useCallback, useContext, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AuthorityLabels } from "@/lib/operations-labels";
import { OPERATIONS_AUTH_INVALIDATED, disposeOperationsReadDeadlines } from "@/lib/operations-query";
import type { ClientScope } from "@/lib/operations-read-contract";

const AuthorityContext = createContext<{ scope: ClientScope; current: () => boolean; deny: () => void; capture: () => () => boolean } | null>(null);
export function OperationsQueryProvider({ scope, children, labels }: { scope: ClientScope; children: ReactNode; labels: AuthorityLabels }) {
  return <ScopedProvider key={JSON.stringify(scope)} scope={scope} labels={labels}>{children}</ScopedProvider>;
}
function ScopedProvider({ scope, children, labels }: { scope: ClientScope; children: ReactNode; labels: AuthorityLabels }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { mutations: { retry: false } } }));
  const [denied, setDenied] = useState(false);
  const generation = useRef(0);
  const live = useRef(true);
  const current = () => live.current;
  const deny = useCallback(() => { live.current = false; generation.current++; void client.cancelQueries(); client.clear(); disposeOperationsReadDeadlines(client); setDenied(true); }, [client]);
  useLayoutEffect(() => {
    live.current = true;
    window.addEventListener(OPERATIONS_AUTH_INVALIDATED, deny);
    const generationRef = generation;
    return () => { live.current = false; generationRef.current++; window.removeEventListener(OPERATIONS_AUTH_INVALIDATED, deny); void client.cancelQueries(); client.clear(); disposeOperationsReadDeadlines(client); };
  }, [client, deny]);
  return <QueryClientProvider client={client}><AuthorityContext.Provider value={{ scope, current, deny, capture: () => { const captured = generation.current; return () => live.current && generation.current === captured; } }}>{denied ? <div role="alert" className="p-4"><p>{labels["權限或登入狀態已變更。請重新整理後繼續。"]}</p><button type="button" className="mt-3 min-h-12 min-w-12 rounded-md border px-4" onClick={() => window.location.reload()}>{labels["重新整理"]}</button></div> : children}</AuthorityContext.Provider></QueryClientProvider>;
}
export function useOperationsAuthority() {
  const value = useContext(AuthorityContext);
  if (!value) throw new Error("OPERATIONS_SCOPE_PROVIDER_REQUIRED");
  return value;
}
export function useOptionalOperationsAuthority() { return useContext(AuthorityContext); }
