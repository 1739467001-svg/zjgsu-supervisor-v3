import { describe, expect, it } from "vitest";
import { courseCalendar, validateMbaCalendar } from "./courseCalendar";
import { calculateWeekFromDate } from "./dateUtils";

describe("独立 MBA 周历", () => {
  const semester = { startDate: "2026-09-14", totalWeeks: 18, mbaStartDate: "2026-09-07", mbaTotalWeeks: 19 };
  it("9月12、13日属于MBA第一周，普通课不能使用这些日期", () => {
    for (const date of ["2026-09-12", "2026-09-13"]) {
      expect(calculateWeekFromDate(date, courseCalendar(semester, "MBA学院"))).toBe(1);
      expect(calculateWeekFromDate(date, courseCalendar(semester, "工商管理学院"))).toBeUndefined();
    }
  });
  it("同一日期按各自课程计算周次", () => {
    expect(calculateWeekFromDate("2026-09-14", courseCalendar(semester, "MBA学院"))).toBe(2);
    expect(calculateWeekFromDate("2026-09-14", courseCalendar(semester, "工商管理学院"))).toBe(1);
  });
  it("不推断未配置的历史MBA周历", () => {
    expect(courseCalendar({ startDate: "2026-03-02", totalWeeks: 19 }, "MBA学院")).toEqual({ startDate: "2026-03-02", totalWeeks: 19 });
  });
  it.each([
    { mbaStartDate: "2026-02-30", mbaTotalWeeks: 18 },
    { mbaStartDate: "2026-09-12", mbaTotalWeeks: 18 },
    { mbaStartDate: "2026-09-07" },
    { mbaTotalWeeks: 18 },
    { mbaStartDate: "2026-09-07", mbaTotalWeeks: 0 },
  ])("拒绝不完整或无效的独立周历 %j", value => {
    expect(() => validateMbaCalendar(value)).toThrow(/MBA 周历须/);
  });
});
