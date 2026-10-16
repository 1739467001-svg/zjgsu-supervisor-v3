import { describe, expect, it } from "vitest";
import { getSemesterInfo, getReminderInfo } from "./scheduler";
describe("提醒采用当前学期与北京时间", () => {
  const autumn = { startDate: "2026-09-14", totalWeeks: 18 };
  it("第一周周一", () => expect(getSemesterInfo(new Date("2026-09-13T16:00:00Z"), autumn)).toEqual({ week: 1, weekdayCN: "星期一" }));
  it("第三周", () => expect(getSemesterInfo(new Date("2026-10-03T04:00:00Z"), autumn)).toEqual({ week: 3, weekdayCN: "星期六" }));
  it("学期开始前不提醒", () => expect(getSemesterInfo(new Date("2026-09-13T10:00:00Z"), autumn)).toBeNull());
  it("学期结束后不提醒", () => expect(getSemesterInfo(new Date("2027-01-18T04:00:00Z"), autumn)).toBeNull());
});

describe("MBA与普通课程提醒采用统一周历", () => {
  const semester = { startDate: "2026-09-14", totalWeeks: 18, mbaStartDate: "2026-09-07", mbaTotalWeeks: 18 };
  it("9月12日为开学前，不发送正常教学周提醒", () => {
    const day = new Date("2026-09-12T04:00:00Z");
    expect(getReminderInfo(day, semester, "MBA学院", 1)).toBeNull();
    expect(getReminderInfo(day, semester, "工商管理学院", 1)).toBeNull();
  });
  it("同一天均为第一周，不再把MBA偏移为第二周", () => {
    const day = new Date("2026-09-19T04:00:00Z");
    expect(getReminderInfo(day, semester, "MBA学院", 2)).toBeNull();
    expect(getReminderInfo(day, semester, "工商管理学院", 1)?.week).toBe(1);
    expect(getReminderInfo(day, semester, "MBA学院", 1)?.week).toBe(1);
    expect(getReminderInfo(day, semester, "工商管理学院", 2)).toBeNull();
  });
  it("不再依赖MBA旧配置，空计划周次不发送", () => {
    const day = new Date("2026-09-19T04:00:00Z");
    expect(getReminderInfo(day, { startDate: semester.startDate, totalWeeks: 18 }, "MBA学院", 1)?.week).toBe(1);
    expect(getReminderInfo(day, semester, "工商管理学院", null)).toBeNull();
  });
  it("两类课程同一天结束教学周", () => {
    const day = new Date("2027-01-11T04:00:00Z");
    expect(getReminderInfo(day, semester, "MBA学院", 18)?.week).toBe(18);
    expect(getReminderInfo(day, semester, "工商管理学院", 18)?.week).toBe(18);
  });
});
