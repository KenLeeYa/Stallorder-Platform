import { Check, Info } from "lucide-react";

const rules = [
  "只能使用小寫英文字母 a-z",
  "可使用數字 0-9",
  "可使用連字號 -",
  "長度 3～50 字元",
  "第一個與最後一個字元必須是英文字母或數字",
  "不可和其他攤位重複",
] as const;

export function PublicIdentifierInputHint({
  children,
  hintId,
}: {
  children: React.ReactNode;
  hintId: string;
}) {
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
          公開識別名稱規則
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
