import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  calculateWeekFromDate,
  calculateDateRangeFromWeek,
  getCurrentWeek,
  isValidFutureDate,
  getMinSelectableDate,
  getMaxSelectableDate,
} from "./dateUtils";
import { SEMESTER_START_DATE, WEEKS_IN_SEMESTER } from "./const";

describe("dateUtils", () => {
  beforeEach(() => {
    // 模拟当前时间为 2026-03-08（学期第二周）
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-08"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("calculateWeekFromDate", () => {
    it("应该计算学期第一周的日期对应的周次", () => {
      expect(calculateWeekFromDate("2026-03-02")).toBe(1);
      expect(calculateWeekFromDate("2026-03-08")).toBe(1);
    });

    it("应该计算学期最后一周的日期对应的周次", () => {
      // 第19周最后一天
      const lastDayOfSemester = new Date(SEMESTER_START_DATE);
      lastDayOfSemester.setDate(lastDayOfSemester.getDate() + (WEEKS_IN_SEMESTER - 1) * 7 + 6);
      const lastDayStr = lastDayOfSemester.toISOString().split("T")[0];
      expect(calculateWeekFromDate(lastDayStr)).toBe(19);
    });

    it("应该返回 undefined 如果日期早于学期开始", () => {
      expect(calculateWeekFromDate("2026-03-01")).toBeUndefined();
    });

    it("应该返回 undefined 如果日期晚于学期结束", () => {
      expect(calculateWeekFromDate("2026-07-20")).toBeUndefined();
    });

    it("应该接受 Date 对象作为输入", () => {
      const date = new Date("2026-03-02");
      expect(calculateWeekFromDate(date)).toBe(1);
    });
  });

  describe("calculateDateRangeFromWeek", () => {
    it("应该计算第一周的日期范围", () => {
      const range = calculateDateRangeFromWeek(1);
      expect(range).toEqual({
        startDate: "2026-03-02",
        endDate: "2026-03-08",
      });
    });

    it("应该计算第二周的日期范围", () => {
      // 学期第 1 周为 03-02(周一) ~ 03-08(周日)，故第 2 周为 03-09 ~ 03-15
      const range = calculateDateRangeFromWeek(2);
      expect(range).toEqual({
        startDate: "2026-03-09",
        endDate: "2026-03-15",
      });
    });

    it("应该返回 undefined 如果周次无效", () => {
      expect(calculateDateRangeFromWeek(0)).toBeUndefined();
      expect(calculateDateRangeFromWeek(20)).toBeUndefined();
      expect(calculateDateRangeFromWeek(-1)).toBeUndefined();
    });
  });

  describe("getCurrentWeek", () => {
    it("应该返回当前周次", () => {
      // 模拟时间为 2026-03-08（第一周）
      expect(getCurrentWeek()).toBe(1);
    });
  });

  describe("isValidFutureDate", () => {
    it("应该接受当前日期及未来日期", () => {
      expect(isValidFutureDate("2026-03-08")).toBe(true);
      expect(isValidFutureDate("2026-03-09")).toBe(true);
    });

    // 督导是"听完课之后"才填评价，可能隔几天补填，
    // 因此学期范围内的过去日期必须允许选择（v2 起已放开该限制）
    it("应该接受学期范围内的过去日期", () => {
      expect(isValidFutureDate("2026-03-07")).toBe(true);
    });

    it("应该拒绝学期开始之前的日期", () => {
      expect(isValidFutureDate("2026-03-01")).toBe(false);
    });

    it("应该拒绝超出学期范围的日期", () => {
      expect(isValidFutureDate("2026-07-20")).toBe(false);
    });

    it("应该接受 Date 对象作为输入", () => {
      const date = new Date("2026-03-08");
      expect(isValidFutureDate(date)).toBe(true);
    });
  });

  describe("getMinSelectableDate", () => {
    // 最小可选日期是"学期第一天"而非"今天"，以便补填本学期内已听过的课
    it("应该返回学期第一天", () => {
      expect(getMinSelectableDate()).toBe(SEMESTER_START_DATE);
    });
  });

  describe("getMaxSelectableDate", () => {
    it("应该返回学期最后一天的日期", () => {
      const maxDate = getMaxSelectableDate();
      // 计算预期的最后一天
      const expectedLastDay = new Date(SEMESTER_START_DATE);
      expectedLastDay.setDate(expectedLastDay.getDate() + (WEEKS_IN_SEMESTER - 1) * 7 + 6);
      const expectedStr = expectedLastDay.toISOString().split("T")[0];
      expect(maxDate).toBe(expectedStr);
    });
  });
});
