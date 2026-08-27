"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { PickupDisplayBoard } from "@/components/pickup-display-board";

const PickupDisplayBoardChunk = dynamic(
  () => import("@/components/pickup-display-board").then((module) => module.PickupDisplayBoard),
  { loading: () => <div className="min-h-screen animate-pulse bg-stone-950" aria-busy="true" /> },
);

export function LazyPickupDisplayBoard(props: ComponentProps<typeof PickupDisplayBoard>) {
  return <PickupDisplayBoardChunk {...props} />;
}
