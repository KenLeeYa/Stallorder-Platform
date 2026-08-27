import { OperationsMessagesBoundary } from "@/components/operations-messages-boundary";

export default function DisplayLayout({ children }: { children: React.ReactNode }) {
  return <OperationsMessagesBoundary>{children}</OperationsMessagesBoundary>;
}
