export const DEFAULT_DINING_FLOOR_NAME = "1樓";
export const VIRTUAL_DINING_FLOOR_KEY = "virtual-first-floor";

export const DINING_TABLE_SHAPES = [
  "CIRCLE",
  "ELLIPSE",
  "SQUARE",
  "RECTANGLE",
  "DIAMOND",
  "TRIANGLE",
] as const;

export type DiningTableShape = (typeof DINING_TABLE_SHAPES)[number];

export const diningTableShapeLabels: Record<DiningTableShape, string> = {
  CIRCLE: "圓桌",
  ELLIPSE: "橢圓桌",
  SQUARE: "方桌",
  RECTANGLE: "長桌",
  DIAMOND: "菱形桌",
  TRIANGLE: "三角桌",
};

export type DiningFloorTab = {
  id: string | null;
  key: string;
  name: string;
  sortOrder: number;
  isVirtual: boolean;
};

export function getDiningFloorTabs(
  floors: ReadonlyArray<{ id: string; name: string; sortOrder: number }>,
  tables: ReadonlyArray<{ floorId: string | null }>,
): DiningFloorTab[] {
  const sortedFloors = [...floors].sort((left, right) => (
    left.sortOrder - right.sortOrder || left.name.localeCompare(right.name, "zh-Hant")
  ));
  const needsVirtualFloor = sortedFloors.length === 0 || tables.some((table) => table.floorId === null);
  return [
    ...(needsVirtualFloor ? [{
      id: null,
      key: VIRTUAL_DINING_FLOOR_KEY,
      name: DEFAULT_DINING_FLOOR_NAME,
      sortOrder: -1,
      isVirtual: true,
    }] : []),
    ...sortedFloors.map((floor) => ({
      ...floor,
      key: floor.id,
      isVirtual: false,
    })),
  ];
}

export function isDiningTableRotation(value: number) {
  return Number.isInteger(value) && value >= 0 && value <= 345 && value % 15 === 0;
}

export function getUnsavedDiningTableFloorMoves<T extends {
  id: string;
  floorId: string | null;
}>(
  tables: ReadonlyArray<T>,
  savedTables: ReadonlyArray<{ id: string; floorId: string | null }>,
) {
  const savedFloorIds = new Map(savedTables.map((table) => [table.id, table.floorId]));
  return tables.filter((table) => (
    savedFloorIds.has(table.id) && savedFloorIds.get(table.id) !== table.floorId
  ));
}
