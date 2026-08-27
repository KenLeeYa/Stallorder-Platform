"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { QrOrderFlow } from "@/components/qr-order-flow";

const QrOrderFlowChunk = dynamic(
  () => import("@/components/qr-order-flow").then((module) => module.QrOrderFlow),
  { loading: () => <div className="min-h-screen animate-pulse bg-stone-50" aria-busy="true" /> },
);

export function LazyQrOrderFlow(props: ComponentProps<typeof QrOrderFlow>) {
  return <QrOrderFlowChunk {...props} />;
}
