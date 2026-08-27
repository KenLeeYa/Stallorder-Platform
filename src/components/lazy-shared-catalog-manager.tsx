"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { SharedCatalogManager } from "@/components/shared-catalog-manager";

const SharedCatalogManagerChunk = dynamic(
  () => import("@/components/shared-catalog-manager").then((module) => module.SharedCatalogManager),
  { loading: () => <div className="min-h-[60vh] animate-pulse bg-stone-100" aria-busy="true" /> },
);

export function LazySharedCatalogManager(props: ComponentProps<typeof SharedCatalogManager>) {
  return <SharedCatalogManagerChunk {...props} />;
}
