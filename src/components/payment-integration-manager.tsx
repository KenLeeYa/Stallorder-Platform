"use client";

import { useMemo, useState } from "react";
import { csrfHeaders } from "@/lib/csrf-client";

type Provider = {
  provider: string;
  label: string;
  connectionMode: string;
  repositorySupport: string;
  mockSupport: boolean;
  sandboxSupport: string;
  liveBlocker: string | null;
  capabilities: string[];
};
type Connection = {
  id: string;
  stallId: string | null;
  provider: string;
  environment: string;
  status: string;
  enabledChannels: string[];
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
  secretReferencePresent: boolean;
};
type Order = { id: string; stallId: string; orderNo: string; total: number; createdAt: string };
type Transaction = { id: string; orderId: string; provider: string; amount: number; currency: string; status: string; createdAt: string };
type Stall = { id: string; name: string };

const channels = ["DINE_IN", "TAKEOUT", "DELIVERY", "STAFF_POS", "PUBLIC_MENU"] as const;
const scenarios = ["SUCCESS_WEBHOOK_BEFORE_RETURN", "SUCCESS_RETURN_BEFORE_WEBHOOK", "PENDING", "FAILED", "EXPIRED", "FULL_REFUND", "RECONCILIATION_MISMATCH"] as const;

type Copy = {
  localOnly: string;
  localOnlyDescription: string;
  mockConnection: string;
  stall: string;
  provider: string;
  manualOnly: string;
  configure: string;
  configured: string;
  configureFailed: string;
  mockAcceptance: string;
  mockAcceptanceDescription: string;
  unpaidOrder: string;
  select: string;
  scenario: string;
  run: string;
  testCompleted: string;
  testCompletedEvidence: string;
  testFailed: string;
  connections: string;
  secretReference: string;
  present: string;
  missing: string;
  enabledChannels: string;
  none: string;
  noConnections: string;
  recentTransactions: string;
  order: string;
  noTransactions: string;
  channelLabels: Record<(typeof channels)[number], string>;
  scenarioLabels: Record<(typeof scenarios)[number], string>;
};

export function PaymentIntegrationManager({
  organizationId,
  stalls,
  providers,
  initialConnections,
  orders,
  initialTransactions,
  copy,
}: {
  organizationId: string;
  stalls: Stall[];
  providers: Provider[];
  initialConnections: Connection[];
  orders: Order[];
  initialTransactions: Transaction[];
  copy: Copy;
}) {
  const [connections, setConnections] = useState(initialConnections);
  const [transactions, setTransactions] = useState(initialTransactions);
  const [stallId, setStallId] = useState(stalls[0]?.id ?? "");
  const [provider, setProvider] = useState(providers.find((item) => item.provider === "LINE_PAY")?.provider ?? providers[0]?.provider ?? "");
  const [orderId, setOrderId] = useState(orders[0]?.id ?? "");
  const [scenario, setScenario] = useState<(typeof scenarios)[number]>("SUCCESS_WEBHOOK_BEFORE_RETURN");
  const [selectedChannels, setSelectedChannels] = useState<string[]>(["TAKEOUT", "STAFF_POS", "PUBLIC_MENU"]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const selectedProvider = useMemo(() => providers.find((item) => item.provider === provider), [provider, providers]);
  const availableOrders = orders.filter((order) => order.stallId === stallId);

  async function configureMock() {
    setPending(true);
    setMessage("");
    const response = await fetch("/api/merchant/payment-integrations", {
      method: "POST",
      headers: csrfHeaders(),
      body: JSON.stringify({ organizationId, stallId, provider, environment: "MOCK", enabledChannels: selectedChannels }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.connection) {
      setConnections((current) => [
        ...current.filter((connection) => !(connection.stallId === stallId && connection.provider === provider && connection.environment === "MOCK")),
        { ...body.connection, stallId, lastVerifiedAt: new Date().toISOString(), lastErrorCode: null },
      ]);
      setMessage(copy.configured);
    } else {
      setMessage(typeof body.error === "string" ? body.error : copy.configureFailed);
    }
    setPending(false);
  }

  async function runMock() {
    if (!orderId) return;
    setPending(true);
    setMessage("");
    const idempotencyKey = crypto.randomUUID();
    const response = await fetch("/api/merchant/payment-integrations/mock", {
      method: "POST",
      headers: { ...csrfHeaders(), "x-idempotency-key": idempotencyKey },
      body: JSON.stringify({ organizationId, stallId, orderId, provider, scenario }),
    });
    const body = await response.json().catch(() => ({}));
    if (response.ok && body.transaction) {
      setTransactions((current) => [body.transaction, ...current.filter((transaction) => transaction.id !== body.transaction.id)]);
      setMessage(`${copy.testCompleted}: ${body.transaction.status}. ${copy.testCompletedEvidence}`);
    } else {
      setMessage(typeof body.error === "string" ? body.error : copy.testFailed);
    }
    setPending(false);
  }

  function toggleChannel(channel: string) {
    setSelectedChannels((current) => current.includes(channel)
      ? current.filter((item) => item !== channel)
      : [...current, channel]);
  }

  return (
    <div className="space-y-8">
      <section className="rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-950">
        <strong>{copy.localOnly}</strong>
        <p className="mt-1">{copy.localOnlyDescription}</p>
      </section>
      {message ? <p role="status" className="rounded-md border border-stone-200 bg-white p-3 text-sm">{message}</p> : null}

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">{copy.mockConnection}</h2>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">{copy.stall}<select value={stallId} onChange={(event) => { setStallId(event.target.value); const first = orders.find((order) => order.stallId === event.target.value); setOrderId(first?.id ?? ""); }} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3">{stalls.map((stall) => <option key={stall.id} value={stall.id}>{stall.name}</option>)}</select></label>
          <label className="text-sm font-medium">{copy.provider}<select value={provider} onChange={(event) => setProvider(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3">{providers.filter((item) => item.provider !== "CASH_MANUAL").map((item) => <option key={item.provider} value={item.provider}>{item.label}</option>)}</select></label>
        </div>
        <div className="mt-4 flex flex-wrap gap-3">{channels.map((channel) => <label key={channel} className="inline-flex min-h-11 items-center gap-2 rounded-md border border-stone-300 px-3 text-sm"><input type="checkbox" checked={selectedChannels.includes(channel)} onChange={() => toggleChannel(channel)} />{copy.channelLabels[channel]}</label>)}</div>
        {selectedProvider ? <p className="mt-4 text-sm text-stone-600">{selectedProvider.connectionMode} · {selectedProvider.repositorySupport} · {selectedProvider.liveBlocker ?? copy.manualOnly}</p> : null}
        <button type="button" onClick={configureMock} disabled={pending || !stallId || !provider} className="mt-5 min-h-11 rounded-md bg-teal-800 px-4 text-sm font-semibold text-white disabled:opacity-50">{copy.configure}</button>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">{copy.mockAcceptance}</h2>
        <p className="mt-1 text-sm text-stone-600">{copy.mockAcceptanceDescription}</p>
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          <label className="text-sm font-medium">{copy.unpaidOrder}<select value={orderId} onChange={(event) => setOrderId(event.target.value)} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3"><option value="">{copy.select}</option>{availableOrders.map((order) => <option key={order.id} value={order.id}>{order.orderNo} · TWD {order.total}</option>)}</select></label>
          <label className="text-sm font-medium">{copy.scenario}<select value={scenario} onChange={(event) => setScenario(event.target.value as (typeof scenarios)[number])} className="mt-1 h-11 w-full rounded-md border border-stone-300 px-3">{scenarios.map((item) => <option key={item} value={item}>{copy.scenarioLabels[item]}</option>)}</select></label>
        </div>
        <button type="button" onClick={runMock} disabled={pending || !orderId || !stallId || !provider} className="mt-5 min-h-11 rounded-md bg-stone-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{copy.run}</button>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">{copy.connections}</h2>
        <div className="mt-4 grid gap-3">{connections.map((connection) => <article key={connection.id} className="rounded-md border border-stone-200 p-4"><div className="flex flex-wrap justify-between gap-2"><strong>{connection.provider}</strong><span>{connection.environment} · {connection.status}</span></div><p className="mt-2 text-sm text-stone-600">{copy.secretReference}: {connection.secretReferencePresent ? copy.present : copy.missing} · {copy.enabledChannels}: {connection.enabledChannels.map((channel) => copy.channelLabels[channel as keyof Copy["channelLabels"]] ?? channel).join(", ") || copy.none}</p></article>)}{connections.length === 0 ? <p className="text-sm text-stone-500">{copy.noConnections}</p> : null}</div>
      </section>

      <section className="rounded-xl border border-stone-200 bg-white p-5">
        <h2 className="text-xl font-semibold">{copy.recentTransactions}</h2>
        <div className="mt-4 divide-y divide-stone-200">{transactions.map((transaction) => <article key={transaction.id} className="py-3 text-sm"><div className="flex flex-wrap justify-between gap-2"><strong>{transaction.provider} · {transaction.status}</strong><span>{transaction.currency} {transaction.amount}</span></div><p className="mt-1 text-stone-500">{copy.order} {transaction.orderId}</p></article>)}{transactions.length === 0 ? <p className="text-sm text-stone-500">{copy.noTransactions}</p> : null}</div>
      </section>
    </div>
  );
}
