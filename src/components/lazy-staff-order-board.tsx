"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { StaffOrderBoard } from "@/components/staff-order-board";

const StaffOrderBoardChunk = dynamic(
  () => import("@/components/staff-order-board").then((module) => module.StaffOrderBoard),
  { loading: () => <div className="min-h-[60vh] animate-pulse bg-stone-100" aria-busy="true" /> },
);

export function LazyStaffOrderBoard(props: ComponentProps<typeof StaffOrderBoard>) {
  return <StaffOrderBoardChunk {...props} />;
}
