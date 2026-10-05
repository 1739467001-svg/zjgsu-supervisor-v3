import { afterEach, describe, expect, it, vi } from "vitest";
import { courseUploadPlan, signUploadPreview, verifyUploadPreview } from "./courseUploadPlan";
import type { ParsedCourse } from "./courseImport";
const course: ParsedCourse = { academicYear: "2026-2027", semester: "第一学期", college: "工商管理学院", courseName: "测试课程", courseType: "必修", classroom: "A101", classId: "TEST", teacher: "测试教师", campus: "测试校区", weekday: "星期一", weekType: "", period: "1-2", customWeeks: "第1周", weekNumbers: [1], studentMajor: "测试专业", studentCount: 20 };
const existing = { ...course, id: 1, semesterId: 2 };
const binding = { file: "file-hash", state: "state-hash", actor: 1, semesterId: 2, format: "standard" as const };
const secret = "test-only-secret-with-at-least-32-characters";
afterEach(() => vi.useRealTimers());
describe("课表预览与历史保护", () => {
  it("重传相同课程幂等，不删除未出现在新文件中的课程", () => {
    const result = courseUploadPlan([course], [existing, { ...existing, id: 2, courseName: "另一课程" }], new Set([1]), "standard");
    expect(result.unchanged).toBe(1);
    expect(result.preserved).toBe(1);
    expect(result.inserts).toHaveLength(0);
    expect(result.updates).toHaveLength(0);
  });
  it("已有评价或计划的课程不得被修改或以新关键字段替换", () => {
    for (const changed of [{ ...course, studentCount: 30 }, { ...course, teacher: "另一教师" }]) {
      const result = courseUploadPlan([changed], [existing], new Set([1]), "standard");
      expect(result.conflicts).toHaveLength(1);
      expect(result.inserts).toHaveLength(0);
      expect(result.updates).toHaveLength(0);
    }
  });
  it("未关联记录可以更新，MBA必须从独立入口导入", () => {
    expect(courseUploadPlan([{ ...course, studentCount: 30 }], [existing], new Set(), "standard").updates).toHaveLength(1);
    expect(() => courseUploadPlan([{ ...course, college: "MBA学院" }], [], new Set(), "standard")).toThrow();
    expect(courseUploadPlan([{ ...course, college: "MBA学院" }], [], new Set(), "mba").inserts).toHaveLength(1);
  });
  it("正式导入绑定文件、数据库快照、账号、学期和入口", () => {
    const token = signUploadPreview(binding, secret);
    expect(() => verifyUploadPreview(token, binding, secret)).not.toThrow();
    for (const changed of [{ file: "changed" }, { state: "changed" }, { actor: 2 }, { semesterId: 3 }, { format: "mba" as const }]) {
      expect(() => verifyUploadPreview(token, { ...binding, ...changed }, secret)).toThrow();
    }
    expect(() => verifyUploadPreview(`${token}tampered`, binding, secret)).toThrow();
  });
  it("过期预览和过短密钥不能用于导入", () => {
    vi.useFakeTimers();
    const token = signUploadPreview(binding, secret);
    vi.advanceTimersByTime(10 * 60 * 1000 + 1);
    expect(() => verifyUploadPreview(token, binding, secret)).toThrow();
    expect(() => signUploadPreview(binding, "short")).toThrow();
  });
});
