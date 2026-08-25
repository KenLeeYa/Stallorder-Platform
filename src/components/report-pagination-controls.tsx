"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  MerchantListPageNavigation,
  MerchantListPageSizeSelect,
} from "@/components/merchant-list-pagination";
import type { OperationsPageMeta, OperationsPageSize } from "@/lib/operations-pagination";

type ReportPaginationProps = {
  label: string;
  pagination: OperationsPageMeta;
  anchorId: string;
};

export function ReportPageSizeSelect({ label, pagination, anchorId }: ReportPaginationProps) {
  const navigate = useReportPagination(anchorId);
  return (
    <MerchantListPageSizeSelect
      label={label}
      value={pagination.pageSize}
      onChange={(pageSize) => navigate(1, pageSize)}
    />
  );
}

export function ReportPageNavigation({ label, pagination, anchorId }: ReportPaginationProps) {
  const navigate = useReportPagination(anchorId);
  return (
    <MerchantListPageNavigation
      label={label}
      pagination={pagination}
      onPageChange={(page) => navigate(page, pagination.pageSize)}
    />
  );
}

function useReportPagination(anchorId: string) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  return (page: number, pageSize: OperationsPageSize) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(page));
    params.set("pageSize", String(pageSize));
    router.push(`${pathname}?${params.toString()}#${anchorId}`, { scroll: false });
  };
}
