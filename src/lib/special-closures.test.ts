import { describe, expect, it } from "vitest";
import {
  activeSpecialClosure,
  findOverlappingSpecialClosure,
  filterPreorderSlotsForSpecialClosures,
  localizeSpecialClosureTitle,
  specialClosureAppliesOnDate,
} from "./special-closures-client";
import { specialClosureCommandSchema } from "./special-closures";

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

  it("accepts a special opening window and rejects an invalid time range", () => {
    expect(specialClosureCommandSchema.safeParse({
      operation: "CREATE",
      startsOn: "2026-09-01",
      endsOn: "2026-09-03",
      opensAt: "15:00",
      closesAt: "19:00",
      title: "特殊營業時間",
      message: "下午三點開始營業",
    }).success).toBe(true);
    expect(specialClosureCommandSchema.safeParse({
      operation: "CREATE",
      startsOn: "2026-09-01",
      endsOn: "2026-09-01",
      opensAt: "19:00",
      closesAt: "15:00",
      title: "特殊營業時間",
      message: "",
    }).success).toBe(false);
  });

  it("accepts updates with the same date and time validation as creates", () => {
    expect(specialClosureCommandSchema.safeParse({
      operation: "UPDATE",
      closureId: "11111111-1111-4111-8111-111111111111",
      startsOn: "2026-09-02",
      endsOn: "2026-09-02",
      opensAt: "14:30",
      closesAt: "19:00",
      title: "特殊營業時間",
      message: "延後開店",
    }).success).toBe(true);
    expect(specialClosureCommandSchema.safeParse({
      operation: "UPDATE",
      closureId: "11111111-1111-4111-8111-111111111111",
      startsOn: "2026-09-02",
      endsOn: "2026-09-02",
      opensAt: "19:00",
      closesAt: "14:30",
      title: "特殊營業時間",
      message: "",
    }).success).toBe(false);
  });

  it("detects inclusive date overlaps and ignores the row being edited", () => {
    const closures = [{
      id: "closure-1",
      startsOn: "2026-09-02",
      endsOn: "2026-09-04",
      title: "公休日",
      message: "",
    }, {
      id: "closure-2",
      startsOn: "2026-09-10",
      endsOn: "2026-09-10",
      opensAt: "15:00",
      closesAt: "19:00",
      title: "特殊營業時間",
      message: "",
    }];

    expect(findOverlappingSpecialClosure(closures, "2026-09-04", "2026-09-05")?.id)
      .toBe("closure-1");
    expect(findOverlappingSpecialClosure(closures, "2026-09-02", "2026-09-04", "closure-1"))
      .toBeNull();
    expect(findOverlappingSpecialClosure(closures, "2026-09-09", "2026-09-10", "closure-1")?.id)
      .toBe("closure-2");
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

  it("identifies every date covered by a special setting, including its boundaries", () => {
    const closure = { startsOn: "2026-09-02", endsOn: "2026-09-04" };

    expect(specialClosureAppliesOnDate(closure, "2026-09-01")).toBe(false);
    expect(specialClosureAppliesOnDate(closure, "2026-09-02")).toBe(true);
    expect(specialClosureAppliesOnDate(closure, "2026-09-04")).toBe(true);
    expect(specialClosureAppliesOnDate(closure, "2026-09-05")).toBe(false);
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

  it("keeps preorder slots only inside a special opening window", () => {
    const specialHours = {
      id: "special-hours-1",
      startsOn: "2026-09-01",
      endsOn: "2026-09-02",
      opensAt: "15:00",
      closesAt: "19:00",
      title: "特殊營業時間",
      message: "",
    };

    expect(filterPreorderSlotsForSpecialClosures([
      "2026-09-01T06:59:00.000Z",
      "2026-09-01T07:00:00.000Z",
      "2026-09-01T10:59:00.000Z",
      "2026-09-01T11:00:00.000Z",
    ], [specialHours], "Asia/Taipei")).toEqual([
      "2026-09-01T07:00:00.000Z",
      "2026-09-01T10:59:00.000Z",
    ]);
  });

  it("blocks live ordering outside special hours and allows it inside", () => {
    const specialHours = [{
      id: "special-hours-1",
      startsOn: "2026-09-01",
      endsOn: "2026-09-01",
      opensAt: "15:00",
      closesAt: "19:00",
      title: "特殊營業時間",
      message: "",
    }];

    expect(activeSpecialClosure(
      specialHours,
      "Asia/Taipei",
      new Date("2026-09-01T06:59:00.000Z"),
    )?.id).toBe("special-hours-1");
    expect(activeSpecialClosure(
      specialHours,
      "Asia/Taipei",
      new Date("2026-09-01T07:00:00.000Z"),
    )).toBeNull();
    expect(activeSpecialClosure(
      specialHours,
      "Asia/Taipei",
      new Date("2026-09-01T11:00:00.000Z"),
    )?.id).toBe("special-hours-1");
  });

  it.each([
    ["en", "Temporary closure"],
    ["ja", "臨時休業"],
    ["ko", "임시 휴무"],
    ["vi", "Tạm nghỉ"],
    ["th", "ปิดชั่วคราว"],
  ] as const)("localizes the system closure title for %s", (locale, expected) => {
    expect(localizeSpecialClosureTitle("臨時店休", locale)).toBe(expected);
  });

  it("preserves merchant-authored closure titles", () => {
    expect(localizeSpecialClosureTitle("員工旅遊", "en")).toBe("員工旅遊");
  });
});
