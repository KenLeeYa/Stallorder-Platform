import { describe, expect, it } from "vitest";
import {
  activeSpecialClosure,
  filterPreorderSlotsForSpecialClosures,
  specialClosureCommandSchema,
} from "./special-closures";

describe("special closures", () => {
  it("accepts a single date and a bounded date range", () => {
    expect(specialClosureCommandSchema.safeParse({
      operation: "CREATE",
      startsOn: "2026-08-21",
      endsOn: "2026-08-21",
      title: "今日公休",
      message: "明天正常營業",
    }).success).toBe(true);
    expect(specialClosureCommandSchema.safeParse({
      operation: "CREATE",
      startsOn: "2026-08-23",
      endsOn: "2026-08-21",
      title: "公休",
      message: "",
    }).success).toBe(false);
  });

  it("resolves the active closure in the stall timezone", () => {
    const closure = activeSpecialClosure([{
      id: "closure-1",
      startsOn: "2026-08-21",
      endsOn: "2026-08-22",
      title: "員工旅遊",
      message: "8/23 恢復營業",
    }], "Asia/Taipei", new Date("2026-08-20T16:30:00.000Z"));

    expect(closure?.id).toBe("closure-1");
  });

  it("filters preorder instants by the stall-local closure date", () => {
    const closure = {
      id: "closure-1",
      startsOn: "2026-08-22",
      endsOn: "2026-08-22",
      title: "公休",
      message: "",
    };

    expect(filterPreorderSlotsForSpecialClosures([
      "2026-08-21T16:30:00.000Z",
      "2026-08-22T16:30:00.000Z",
    ], [closure], "Asia/Taipei")).toEqual([
      "2026-08-22T16:30:00.000Z",
    ]);
  });
});
