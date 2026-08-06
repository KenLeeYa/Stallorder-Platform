import type { DiningTableShape } from "@/lib/dining-floor";

export function DiningTableShapeGraphic({
  shape,
  rotationDegrees,
  className = "",
}: {
  shape: DiningTableShape;
  rotationDegrees: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 120 80"
      className={className}
      preserveAspectRatio="xMidYMid meet"
    >
      <g
        transform={`rotate(${rotationDegrees} 60 40)`}
        className="fill-current opacity-20 stroke-current"
        strokeWidth="3"
      >
        {shape === "CIRCLE" ? <circle cx="60" cy="40" r="30" /> : null}
        {shape === "ELLIPSE" ? <ellipse cx="60" cy="40" rx="48" ry="24" /> : null}
        {shape === "SQUARE" ? <rect x="30" y="10" width="60" height="60" rx="5" /> : null}
        {shape === "RECTANGLE" ? <rect x="12" y="17" width="96" height="46" rx="5" /> : null}
        {shape === "DIAMOND" ? <polygon points="60,5 100,40 60,75 20,40" strokeLinejoin="round" /> : null}
        {shape === "TRIANGLE" ? <polygon points="60,6 108,70 12,70" strokeLinejoin="round" /> : null}
      </g>
    </svg>
  );
}
