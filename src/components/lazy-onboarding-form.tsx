"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { OnboardingForm } from "@/components/onboarding-form";

const OnboardingFormChunk = dynamic(
  () => import("@/components/onboarding-form").then((module) => module.OnboardingForm),
  { loading: () => <div className="min-h-[50vh] animate-pulse bg-stone-100" aria-busy="true" /> },
);

export function LazyOnboardingForm(props: ComponentProps<typeof OnboardingForm>) {
  return <OnboardingFormChunk {...props} />;
}
