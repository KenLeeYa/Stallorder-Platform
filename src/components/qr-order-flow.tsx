"use client";

import {
  useQrOrderFlowController,
  type QrOrderFlowControllerInput,
} from "@/components/qr-order-flow-controller";
import { QrOrderFlowPresentation } from "@/components/qr-order-flow-presentation";

export type QrOrderFlowProps = QrOrderFlowControllerInput;

export function QrOrderFlow(props: QrOrderFlowProps) {
  const controller = useQrOrderFlowController(props);
  return <QrOrderFlowPresentation controller={controller} />;
}
