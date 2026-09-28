"use client";

import { StaffOrderBoardPresentation } from "@/components/staff-order-board-presentation";
import {
  useStaffOrderBoardController,
  type StaffOrderBoardControllerInput,
} from "@/components/staff-order-board-controller";

export type StaffOrderBoardProps = StaffOrderBoardControllerInput & { queueRedesignEnabled?: boolean };

export function StaffOrderBoard(props: StaffOrderBoardProps) {
  const presentation = useStaffOrderBoardController(props);
  return <StaffOrderBoardPresentation {...presentation} queueRedesignEnabled={props.queueRedesignEnabled ?? false} />;
}
