export type QrPrintTarget = "stall" | "table" | "tables";
export type QrPrintPaper = "A4" | "A5" | "A6";

export function normalizeQrPrintRequest(input: {
  target?: string;
  paper?: string;
  tableId?: string;
}) {
  const target: QrPrintTarget = input.target === "table" || input.target === "tables"
    ? input.target
    : "stall";
  const normalizedPaper = input.paper?.toUpperCase();
  const requestedPaper: QrPrintPaper = normalizedPaper === "A5" || normalizedPaper === "A6"
    ? normalizedPaper
    : "A4";
  return {
    target,
    paper: target === "tables" ? "A4" as const : requestedPaper,
    tableId: target === "table" && input.tableId?.trim() ? input.tableId.trim() : null,
  };
}

export function paginateQrPrintItems<T>(items: T[], target: QrPrintTarget): T[][] {
  if (items.length === 0) return [];
  if (target !== "tables") return [items.slice(0, 1)];
  const pages: T[][] = [];
  for (let offset = 0; offset < items.length; offset += 6) {
    pages.push(items.slice(offset, offset + 6));
  }
  return pages;
}
