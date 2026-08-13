"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { Grip, Move } from "lucide-react";
import { DiningTableShapeGraphic } from "@/components/dining-table-shape";
import { useOperationsLocale } from "@/components/operations-locale";
import type { DiningTableShape } from "@/lib/dining-floor";
import {
  clampFloorCoordinate,
  moveFloorPosition,
} from "@/lib/dining-floor-layout";

export type EditableFloorTable = {
  id: string;
  code: string;
  label: string;
  isActive: boolean;
  layoutX: number;
  layoutY: number;
  shape: DiningTableShape;
  rotationDegrees: number;
};

type DragState = {
  tableId: string;
  offsetX: number;
  offsetY: number;
};

export function DiningFloorEditor({
  tables,
  disabled,
  onMove,
}: {
  tables: EditableFloorTable[];
  disabled: boolean;
  onMove: (tableId: string, position: { layoutX: number; layoutY: number }) => void;
}) {
  const { t } = useOperationsLocale();
  const boardRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<DragState | null>(null);

  function boardCoordinate(clientX: number, clientY: number) {
    const board = boardRef.current;
    if (!board) return null;
    const bounds = board.getBoundingClientRect();
    return {
      x: ((clientX - bounds.left) / bounds.width) * 1_000,
      y: ((clientY - bounds.top) / bounds.height) * 1_000,
    };
  }

  function beginDrag(event: ReactPointerEvent<HTMLButtonElement>, table: EditableFloorTable) {
    if (disabled) return;
    const coordinate = boardCoordinate(event.clientX, event.clientY);
    if (!coordinate) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    setDrag({
      tableId: table.id,
      offsetX: coordinate.x - table.layoutX,
      offsetY: coordinate.y - table.layoutY,
    });
  }

  function continueDrag(event: ReactPointerEvent<HTMLButtonElement>, tableId: string) {
    if (!drag || drag.tableId !== tableId) return;
    const coordinate = boardCoordinate(event.clientX, event.clientY);
    if (!coordinate) return;
    onMove(tableId, {
      layoutX: clampFloorCoordinate(coordinate.x - drag.offsetX),
      layoutY: clampFloorCoordinate(coordinate.y - drag.offsetY),
    });
  }

  return (
    <div role="region" aria-label={t("dining.editor.region")}>
      <div
        ref={boardRef}
        className="relative aspect-[4/3] w-full overflow-hidden rounded-md border border-stone-300 bg-stone-50"
        style={{
          backgroundImage: "linear-gradient(to right, #e7e5e4 1px, transparent 1px), linear-gradient(to bottom, #e7e5e4 1px, transparent 1px)",
          backgroundSize: "10% 10%",
        }}
      >
        {tables.map((table) => (
          <button
            key={table.id}
            type="button"
            aria-label={t("dining.editor.move", { table: table.label })}
            disabled={disabled}
            onPointerDown={(event) => beginDrag(event, table)}
            onPointerMove={(event) => continueDrag(event, table.id)}
            onPointerUp={() => setDrag(null)}
            onPointerCancel={() => setDrag(null)}
            onKeyDown={(event) => {
              const key = event.key;
              if (key !== "ArrowUp" && key !== "ArrowDown" && key !== "ArrowLeft" && key !== "ArrowRight") return;
              event.preventDefault();
              onMove(table.id, moveFloorPosition(
                { layoutX: table.layoutX, layoutY: table.layoutY },
                key,
                event.shiftKey,
              ));
            }}
            className={`absolute flex h-[16%] w-[18%] touch-none select-none flex-col items-center justify-center overflow-hidden rounded-md border px-1 text-center shadow-sm focus:outline-none focus:ring-2 focus:ring-teal-600 disabled:cursor-wait ${table.isActive ? "border-teal-700 bg-white text-stone-900" : "border-stone-300 bg-stone-200 text-stone-500"}`}
            style={{ left: `${table.layoutX / 10}%`, top: `${table.layoutY / 10}%` }}
          >
            <DiningTableShapeGraphic shape={table.shape} rotationDegrees={table.rotationDegrees} className="pointer-events-none absolute inset-0 h-full w-full" />
            <Grip className="relative mb-1 h-3.5 w-3.5 shrink-0 text-stone-400" />
            <span className="relative line-clamp-2 text-xs font-semibold sm:text-sm">{table.label}</span>
            <span className="relative hidden text-[10px] text-stone-500 sm:block">{table.code}</span>
          </button>
        ))}
        {tables.length === 0 ? (
          <div className="absolute inset-0 grid place-items-center text-sm text-stone-500">{t("dining.editor.empty")}</div>
        ) : null}
      </div>
      <p className="mt-2 flex items-center gap-2 text-xs text-stone-500">
        <Move className="h-3.5 w-3.5" />{t("dining.editor.hint")}
      </p>
    </div>
  );
}
