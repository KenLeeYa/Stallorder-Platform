export type LocationGuideImageFraming = {
  positionX?: number | null;
  positionY?: number | null;
  zoom?: number | null;
};

export function normalizeLocationGuideImageFraming(framing: LocationGuideImageFraming) {
  return {
    positionX: clampRounded(framing.positionX ?? 50, 0, 100),
    positionY: clampRounded(framing.positionY ?? 50, 0, 100),
    zoom: clampRounded(framing.zoom ?? 100, 100, 200),
  };
}

export function locationGuideImageStyle(framing: LocationGuideImageFraming) {
  const normalized = normalizeLocationGuideImageFraming(framing);
  return {
    objectPosition: `${normalized.positionX}% ${normalized.positionY}%`,
    transform: `scale(${normalized.zoom / 100})`,
    transformOrigin: `${normalized.positionX}% ${normalized.positionY}%`,
  };
}

function clampRounded(value: number, min: number, max: number) {
  const finiteValue = Number.isFinite(value) ? Math.round(value) : min;
  return Math.min(max, Math.max(min, finiteValue));
}
