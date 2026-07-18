export const OPERATIONS_PAGE_SIZES = [5, 10, 25, 50, 100] as const;

export type OperationsPageSize = (typeof OPERATIONS_PAGE_SIZES)[number];

export type OperationsPageRequest = {
  page: number;
  pageSize: OperationsPageSize;
};

export type OperationsPageMeta = OperationsPageRequest & {
  total: number;
  totalPages: number;
  firstItem: number;
  lastItem: number;
};

export function parseOperationsPageSize(value: string | undefined): OperationsPageSize {
  const parsed = Number(value);
  return OPERATIONS_PAGE_SIZES.includes(parsed as OperationsPageSize)
    ? parsed as OperationsPageSize
    : 10;
}

export function parseOperationsPage(value: string | undefined) {
  if (!value || !/^\d{1,6}$/.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1;
}

export function buildOperationsPageMeta(
  total: number,
  request: OperationsPageRequest,
): OperationsPageMeta {
  const safeTotal = Math.max(0, Math.trunc(total));
  const totalPages = Math.max(1, Math.ceil(safeTotal / request.pageSize));
  const page = Math.min(Math.max(1, request.page), totalPages);
  const firstItem = safeTotal === 0 ? 0 : ((page - 1) * request.pageSize) + 1;
  const lastItem = safeTotal === 0 ? 0 : Math.min(page * request.pageSize, safeTotal);
  return { page, pageSize: request.pageSize, total: safeTotal, totalPages, firstItem, lastItem };
}
