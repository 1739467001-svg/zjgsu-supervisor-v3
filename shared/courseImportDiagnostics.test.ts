import { describe, expect, it } from "vitest";
import { courseIssuesCsv, type CourseImportIssue } from "./courseImportDiagnostics";
const issue: CourseImportIssue = { kind: "outside_weeks", sourceRow: 12, courseName: '课程,"原名"', classId: "测试班", teacher: "测试教师", date: "2026-09-12", week: 0, reason: "原日期第0周" };
describe("课表核查清单", () => {
  it("保留中文、原行号、第0周、逗号与引号，使用Excel可读编码", () => {
    const csv = courseIssuesCsv([issue], "原工作表");
    expect(csv.startsWith("\ufeff")).toBe(true);
    expect(csv).toContain('"原工作表","12","课程,""原名"""');
    expect(csv).toContain('"2026-09-12","0","原日期第0周"');
  });
  it("原文件内容不能被电子表格作为公式执行", () => {
    for (const courseName of ["=1+1", " @SUM(1)", "+1+1", "-1+1", "\t=1+1"]) {
      expect(courseIssuesCsv([{ ...issue, courseName }], "原表")).toContain(`"'${courseName}"`);
    }
  });
});
