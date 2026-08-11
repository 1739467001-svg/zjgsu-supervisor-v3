/**
 * 统计仪表盘学院维度的对账测试（R4）
 *
 * 会议反馈：「各学院督导评价次数」「督导评价学院分布」「各学院平均评分」
 * 三张图学院数量互不一致（实际 20 个学院，报表只显示 8~12 个），
 * 且无法与「已完成督导评价」总数对上账。
 */
import { describe, expect, it } from "vitest";
import { buildCollegeStats } from "./db";

const colleges = ["经济学院", "会计学院", "法学院（知识产权学院）", "马克思主义学院"];

describe("buildCollegeStats", () => {
  it("零评价的学院也必须出现在结果中", () => {
    const stats = buildCollegeStats({
      collegeNames: colleges,
      aggregates: [{ college: "经济学院", count: 3, avgScore: 4.5, scoredCount: 3 }],
      totalSubmitted: 3,
    });

    expect(stats).toHaveLength(4);
    const 马院 = stats.find((s) => s.college === "马克思主义学院");
    expect(马院).toBeDefined();
    expect(马院!.count).toBe(0);
  });

  it("各学院数量之和必须等于已提交评价总数", () => {
    const stats = buildCollegeStats({
      collegeNames: colleges,
      aggregates: [
        { college: "经济学院", count: 5, avgScore: 4.2, scoredCount: 5 },
        { college: "会计学院", count: 3, avgScore: 4.8, scoredCount: 2 },
      ],
      totalSubmitted: 8,
    });

    expect(stats.reduce((s, c) => s + c.count, 0)).toBe(8);
  });

  it("关联课程已删除的孤立评价应归入未知学院，不得凭空消失", () => {
    // 总共 10 条已提交评价，但能 JOIN 上课程的只有 7 条
    const stats = buildCollegeStats({
      collegeNames: colleges,
      aggregates: [
        { college: "经济学院", count: 4, avgScore: 4.0, scoredCount: 4 },
        { college: "会计学院", count: 3, avgScore: 4.5, scoredCount: 3 },
      ],
      totalSubmitted: 10,
    });

    const 未知 = stats.find((s) => s.college.startsWith("未知学院"));
    expect(未知?.count).toBe(3);
    expect(stats.reduce((s, c) => s + c.count, 0)).toBe(10);
  });

  it("没有评分数据的学院，平均分应为 null 而不是 0 分", () => {
    const stats = buildCollegeStats({
      collegeNames: colleges,
      aggregates: [{ college: "经济学院", count: 2, avgScore: null, scoredCount: 0 }],
      totalSubmitted: 2,
    });

    expect(stats.find((s) => s.college === "经济学院")!.avgScore).toBeNull();
    expect(stats.find((s) => s.college === "会计学院")!.avgScore).toBeNull();
  });

  it("平均分保留两位小数", () => {
    const stats = buildCollegeStats({
      collegeNames: ["经济学院"],
      aggregates: [{ college: "经济学院", count: 3, avgScore: 4.336666, scoredCount: 3 }],
      totalSubmitted: 3,
    });

    expect(stats[0].avgScore).toBe(4.34);
  });

  it("应按评价数量降序排列，便于一眼看出评得多与评得少的学院", () => {
    const stats = buildCollegeStats({
      collegeNames: colleges,
      aggregates: [
        { college: "会计学院", count: 9, avgScore: 4.1, scoredCount: 9 },
        { college: "经济学院", count: 2, avgScore: 4.9, scoredCount: 2 },
      ],
      totalSubmitted: 11,
    });

    expect(stats[0].college).toBe("会计学院");
    expect(stats[1].college).toBe("经济学院");
    // 零评价的学院排在末尾
    expect(stats[stats.length - 1].count).toBe(0);
  });

  it("应忽略空白学院名，避免出现空标签", () => {
    const stats = buildCollegeStats({
      collegeNames: ["经济学院", "", null, "  "],
      aggregates: [{ college: "经济学院", count: 1, avgScore: 5, scoredCount: 1 }],
      totalSubmitted: 1,
    });

    expect(stats).toHaveLength(1);
    expect(stats[0].college).toBe("经济学院");
  });
});
