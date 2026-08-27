import { OperationsMessagesBoundary } from "@/components/operations-messages-boundary";

export default function KitchenLayout({ children }: { children: React.ReactNode }) {
  return <OperationsMessagesBoundary>{children}</OperationsMessagesBoundary>;
}
