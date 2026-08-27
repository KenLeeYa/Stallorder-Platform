"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { KitchenBoard } from "@/components/kitchen-board";

const KitchenBoardChunk = dynamic(
  () => import("@/components/kitchen-board").then((module) => module.KitchenBoard),
  { loading: () => <div className="min-h-[60vh] animate-pulse bg-stone-100" aria-busy="true" /> },
);

export function LazyKitchenBoard(props: ComponentProps<typeof KitchenBoard>) {
  return <KitchenBoardChunk {...props} />;
}
