import { Check, Info } from "lucide-react";
import type { AppLocale } from "@/lib/app-locale";
import { onboardingMessages } from "@/lib/messages/onboarding";

export function PublicIdentifierInputHint({
  children,
  hintId,
  locale = "zh-TW",
}: {
  children: React.ReactNode;
  hintId: string;
  locale?: AppLocale;
}) {
  const rules = [
    onboardingMessages.get(locale, "identifierRuleLetters"),
    onboardingMessages.get(locale, "identifierRuleNumbers"),
    onboardingMessages.get(locale, "identifierRuleHyphen"),
    onboardingMessages.get(locale, "identifierRuleLength"),
    onboardingMessages.get(locale, "identifierRuleEnds"),
    onboardingMessages.get(locale, "identifierRuleUnique"),
  ];
  return (
    <div className="group relative">
      {children}
      <div
        id={hintId}
        role="tooltip"
        className="pointer-events-none absolute left-0 right-0 top-full z-30 mt-2 rounded-md border border-stone-200 bg-white p-3 text-xs text-stone-700 opacity-0 shadow-lg transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
      >
        <p className="flex items-center gap-2 font-semibold text-stone-900">
          <Info className="h-4 w-4 shrink-0 text-teal-700" />
          {onboardingMessages.get(locale, "identifierRulesTitle")}
        </p>
        <ul className="mt-2 space-y-1.5">
          {rules.map((rule) => (
            <li key={rule} className="flex items-start gap-2">
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-teal-700" />
              <span>{rule}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
