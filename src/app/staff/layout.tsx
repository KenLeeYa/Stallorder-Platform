import { OperationsMessagesBoundary } from "@/components/operations-messages-boundary";

export default function StaffLayout({ children }: { children: React.ReactNode }) {
  return <OperationsMessagesBoundary>{children}</OperationsMessagesBoundary>;
}
