export type CourseImportIssue = {
  kind: "missing_course" | "missing_teacher" | "invalid_date" | "outside_weeks" | "no_weeks";
  sourceRow: number;
  courseName: string;
  classId: string;
  teacher: string;
  date: string;
  week: number | null;
  reason: string;
};

/** 核查清单保留原字符串，使用UTF-8 BOM和带引号的CSV；内容不能执行为电子表格公式。 */
export function courseIssuesCsv(issues: CourseImportIssue[], sheetName: string): string {
  const cell = (value: unknown) => {
    const text = String(value ?? "");
    const safe = /^[\s\u0000-\u001f]*[=+\-@]/.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const rows: unknown[][] = [["原工作表", "原文件行号", "课程名称", "班级", "授课教师", "原日期", "换算周次", "待核查原因"]];
  rows.push(...issues.map(issue => [sheetName, issue.sourceRow, issue.courseName, issue.classId, issue.teacher, issue.date, issue.week, issue.reason]));
  return "\ufeff" + rows.map(row => row.map(cell).join(",")).join("\r\n") + "\r\n";
}
