export const FLOOR_COORDINATE_MAX = 820;

export type FloorPosition = { layoutX: number; layoutY: number };

export function clampFloorCoordinate(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(FLOOR_COORDINATE_MAX, Math.max(0, Math.round(value)));
}

export function initialFloorPosition(index: number): FloorPosition {
  const slot = Math.max(0, Math.trunc(index)) % 25;
  return {
    layoutX: 60 + (slot % 5) * 190,
    layoutY: 80 + Math.floor(slot / 5) * 185,
  };
}

export function moveFloorPosition(
  position: FloorPosition,
  key: "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight",
  largeStep = false,
): FloorPosition {
  const step = largeStep ? 50 : 10;
  return {
    layoutX: clampFloorCoordinate(position.layoutX + (key === "ArrowRight" ? step : key === "ArrowLeft" ? -step : 0)),
    layoutY: clampFloorCoordinate(position.layoutY + (key === "ArrowDown" ? step : key === "ArrowUp" ? -step : 0)),
  };
}
