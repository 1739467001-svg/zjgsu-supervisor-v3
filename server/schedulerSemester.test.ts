import { describe, expect, it } from "vitest";
import { getSemesterInfo } from "./scheduler";
describe("提醒采用当前学期与北京时间", () => {
  const autumn = { startDate: "2026-09-14", totalWeeks: 18 };
  it("第一周周一", () => expect(getSemesterInfo(new Date("2026-09-13T16:00:00Z"), autumn)).toEqual({ week: 1, weekdayCN: "星期一" }));
  it("第三周", () => expect(getSemesterInfo(new Date("2026-10-03T04:00:00Z"), autumn)).toEqual({ week: 3, weekdayCN: "星期六" }));
  it("学期开始前不提醒", () => expect(getSemesterInfo(new Date("2026-09-13T10:00:00Z"), autumn)).toBeNull());
  it("学期结束后不提醒", () => expect(getSemesterInfo(new Date("2027-01-18T04:00:00Z"), autumn)).toBeNull());
});
