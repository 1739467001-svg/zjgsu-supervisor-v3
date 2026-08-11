/**
 * Excel 导出结构测试（R2）
 *
 * 会议要求：
 *   (1) 原先不同专业分散在不同工作表内，全部记录要合并在一张表；
 *   (2) 合并后需增加「学生专业」与「督导角色」两个字段。
 */
import { describe, expect, it } from "vitest";
import XLSX from "xlsx";
import { generateEvaluationExcel, getRoleLabel } from "./exportUtils";

function makeEvaluation(overrides: any = {}) {
  return {
    id: 1,
    courseId: 1,
    supervisorId: 1,
    status: "submitted",
    listenDate: new Date("2026-03-12"),
    actualWeek: 3,
    overallScore: 4.5,
    highlights: "讲解清晰",
    suggestions: "可增加互动",
    improvement_suggestion: "建议一",
    development_suggestion: "建议二",
    createdAt: new Date("2026-03-12"),
    updatedAt: new Date("2026-03-12"),
    course: {
      courseName: "算法分析与设计",
      teacher: "张老师",
      college: "计算机科学与技术学院",
      campus: "下沙",
      courseType: "学位课",
      studentMajor: "计算机科学与技术",
      classId: "C001",
      classroom: "1-201",
      weekday: "星期四",
      period: "第3-4节",
      studentCount: 30,
    },
    supervisor: { name: "王督导", email: "w@zjgsu.edu.cn", role: "supervisor_expert" },
    ...overrides,
  } as any;
}

function readSheets(buffer: Buffer) {
  const wb = XLSX.read(buffer, { type: "buffer" });
  return wb;
}

describe("generateEvaluationExcel", () => {
  it("不同专业的记录必须合并在同一张工作表内", () => {
    const evaluations = [
      makeEvaluation({ id: 1 }),
      makeEvaluation({
        id: 2,
        course: { ...makeEvaluation().course, studentMajor: "软件工程", courseName: "软件测试" },
      }),
      makeEvaluation({
        id: 3,
        course: { ...makeEvaluation().course, studentMajor: "网络空间安全", courseName: "密码学" },
      }),
    ];

    const wb = readSheets(generateEvaluationExcel(evaluations));

    // 三个不同专业，但只应产生一张表
    expect(wb.SheetNames).toHaveLength(1);

    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(3);
  });

  it("应包含「学生专业」与「督导角色」两个新增字段", () => {
    const wb = readSheets(generateEvaluationExcel([makeEvaluation()]));
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]]);

    expect(Object.keys(rows[0])).toContain("学生专业");
    expect(Object.keys(rows[0])).toContain("督导角色");
    expect(rows[0]["学生专业"]).toBe("计算机科学与技术");
    expect(rows[0]["督导角色"]).toBe("督导专家");
  });

  it("应保留课程与评价的关键信息", () => {
    const wb = readSheets(generateEvaluationExcel([makeEvaluation()]));
    const rows = XLSX.utils.sheet_to_json<Record<string, any>>(wb.Sheets[wb.SheetNames[0]]);

    expect(rows[0]["课程名称"]).toBe("算法分析与设计");
    expect(rows[0]["所属学院"]).toBe("计算机科学与技术学院");
    expect(rows[0]["听课周次"]).toBe("第3周");
    expect(rows[0]["教学亮点"]).toBe("讲解清晰");
  });

  it("只导出已提交的评价，草稿不得混入", () => {
    const evaluations = [
      makeEvaluation({ id: 1 }),
      makeEvaluation({ id: 2, status: "draft" }),
    ];

    const wb = readSheets(generateEvaluationExcel(evaluations));
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
    expect(rows).toHaveLength(1);
  });

  it("无数据时应生成提示表而不是报错", () => {
    const wb = readSheets(generateEvaluationExcel([]));
    expect(wb.SheetNames).toHaveLength(1);
  });

  it("表头不得有空列名或重复列名", () => {
    const wb = readSheets(generateEvaluationExcel([makeEvaluation()]));
    const header = XLSX.utils.sheet_to_json<string[]>(wb.Sheets[wb.SheetNames[0]], {
      header: 1,
    })[0];

    expect(header.length).toBeGreaterThan(20);
    expect(header.every((h) => typeof h === "string" && h.trim() !== "")).toBe(true);
    expect(new Set(header).size).toBe(header.length);
  });
});

describe("getRoleLabel", () => {
  it("应把角色标识翻译为中文", () => {
    expect(getRoleLabel("supervisor_expert")).toBe("督导专家");
    expect(getRoleLabel("college_secretary")).toBe("学院教学秘书");
    expect(getRoleLabel("graduate_admin")).toBe("研究生院主管");
  });

  it("未知角色原样返回，空值显示为占位符", () => {
    expect(getRoleLabel("院级督导专家")).toBe("院级督导专家");
    expect(getRoleLabel(null)).toBe("—");
  });
});
