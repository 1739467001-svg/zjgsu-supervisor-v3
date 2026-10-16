import { describe, expect, it } from "vitest";
import { courseCalendar, courseWeekLabel, validateMbaCalendar, validateUnifiedCalendar } from "./courseCalendar";
import { calculateWeekFromDate } from "./dateUtils";

describe("全校统一周历", () => {
  const semester = { startDate: "2026-09-14", totalWeeks: 18, mbaStartDate: "2026-09-07", mbaTotalWeeks: 19 };
  it("9月12、13日均在全校第一周之前，旧MBA字段不再偏移周次", () => {
    for (const date of ["2026-09-12", "2026-09-13"]) {
      expect(calculateWeekFromDate(date, courseCalendar(semester, "MBA学院"))).toBeUndefined();
      expect(calculateWeekFromDate(date, courseCalendar(semester, "工商管理学院"))).toBeUndefined();
    }
  });
  it("同一日期所有学院计算同一周次", () => {
    expect(calculateWeekFromDate("2026-09-14", courseCalendar(semester, "MBA学院"))).toBe(1);
    expect(calculateWeekFromDate("2026-09-14", courseCalendar(semester, "工商管理学院"))).toBe(1);
  });
  it("禁止新建或更新为独立MBA周历", () => {
    expect(() => validateUnifiedCalendar(semester)).toThrow(/统一校历/);
    expect(() => validateUnifiedCalendar({ startDate: "2026-09-14", totalWeeks: 18 })).not.toThrow();
    expect(() => validateUnifiedCalendar({ startDate: "2026-09-07", totalWeeks: 18 })).toThrow(/09-14/);
  });
  it("第0周显示原日期并与正常周次区分", () => {
    expect(courseWeekLabel({weekNumbers:[0,1],weekType:"开学前（第0周）：2026-09-12"})).toBe("开学前（第0周）：2026-09-12；第1周");
    expect(courseWeekLabel({weekNumbers:[0],weekType:""})).toBe("开学前（第0周）");
    expect(courseWeekLabel({weekNumbers:[],weekType:""})).toBe("周次待核查");
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
