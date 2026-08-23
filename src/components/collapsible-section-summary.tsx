import type { LucideIcon } from "lucide-react";

export function CollapsibleSectionSummary({
  icon: Icon,
  title,
  description,
  level = 2,
}: {
  icon: LucideIcon;
  title: string;
  description?: string;
  level?: 2 | 3 | 4;
}) {
  return (
    <div className="flex min-h-14 items-center gap-3 py-3 text-left">
      <Icon aria-hidden="true" className={`${level === 2 ? "h-5 w-5" : "h-4 w-4"} shrink-0 text-teal-700`} />
      <span className="min-w-0 flex-1">
        <span role="heading" aria-level={level} className={`block font-semibold ${level === 2 ? "text-lg" : "text-sm"}`}>{title}</span>
        {description ? <span className="mt-1 block text-sm font-normal text-stone-600">{description}</span> : null}
      </span>
    </div>
  );
}
