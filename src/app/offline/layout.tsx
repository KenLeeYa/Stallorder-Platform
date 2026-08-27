import { OperationsMessagesBoundary } from "@/components/operations-messages-boundary";

export default function OfflineLayout({ children }: { children: React.ReactNode }) {
  return <OperationsMessagesBoundary>{children}</OperationsMessagesBoundary>;
}
