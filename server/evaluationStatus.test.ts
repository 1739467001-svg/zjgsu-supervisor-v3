/**
 * 评价状态流转的回归测试
 *
 * 覆盖两个会议反馈的线上问题：
 *   R10 —— 已提交的评价被打开查看后，会被 30 秒一次的自动保存改回草稿，
 *          督导必须重新提交一次。
 *   R11 —— 评价已提交，但对应课程仍停留在「待听课」列表中。
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { appRouter } from "./routers";
import type { TrpcContext } from "./_core/context";

const updateEvaluation = vi.fn();
const markListeningPlanCompleted = vi.fn();
const createEvaluation = vi.fn();
const getEvaluationById = vi.fn();

vi.mock("./db", () => ({
  getEvaluationById: (...a: any[]) => getEvaluationById(...a),
  updateEvaluation: (...a: any[]) => updateEvaluation(...a),
  createEvaluation: (...a: any[]) => createEvaluation(...a),
  markListeningPlanCompleted: (...a: any[]) => markListeningPlanCompleted(...a),
  getCourseById: vi.fn().mockResolvedValue({
    id: 10,
    courseName: "算法分析与设计",
    teacher: "某老师",
    college: "计算机科学与技术学院",
  }),
  getUsersByRole: vi.fn().mockResolvedValue([]),
  getAllUsers: vi.fn().mockResolvedValue([]),
  createNotification: vi.fn(),
  getUsedWeeksForCourse: vi.fn().mockResolvedValue({ usedWeeks: [], evaluatedWeeks: [] }),
}));

vi.mock("./_core/sdk", () => ({
  sdk: { createSessionToken: vi.fn().mockResolvedValue("mock-token") },
}));

function supervisorContext(): TrpcContext {
  return {
    user: {
      id: 2,
      openId: "supervisor-open-id",
      name: "督导专家",
      email: "supervisor@zjgsu.edu.cn",
      loginMethod: "employee_id",
      role: "supervisor_expert",
      createdAt: new Date(),
      updatedAt: new Date(),
      lastSignedIn: new Date(),
    } as any,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: vi.fn(), cookie: vi.fn() } as unknown as TrpcContext["res"],
  };
}

const baseEvaluation = {
  id: 100,
  supervisorId: 2,
  courseId: 10,
  planId: null,
  actualWeek: 3,
};

beforeEach(() => {
  vi.clearAllMocks();
  createEvaluation.mockResolvedValue({ id: 100 });
});

describe("R10：自动保存不得改变评价状态", () => {
  it("已提交的评价，自动保存后仍应为已提交", async () => {
    getEvaluationById.mockResolvedValue({ ...baseEvaluation, status: "submitted" });
    const caller = appRouter.createCaller(supervisorContext());

    // 完整复刻问题现场：旧版前端的自动保存会显式发送 status:'draft'，
    // 即使客户端仍这么发，服务端也必须拒绝把已提交的评价降级为草稿。
    await caller.evaluations.update({
      id: 100,
      data: { courseId: 10, highlights: "自动保存的内容", status: "draft" } as any,
      autoSave: true,
    });

    expect(updateEvaluation).toHaveBeenCalledTimes(1);
    expect(updateEvaluation.mock.calls[0][1].status).toBe("submitted");
  });

  it("草稿的评价，自动保存后仍应为草稿", async () => {
    getEvaluationById.mockResolvedValue({ ...baseEvaluation, status: "draft" });
    const caller = appRouter.createCaller(supervisorContext());

    await caller.evaluations.update({
      id: 100,
      data: { courseId: 10, highlights: "草稿内容" } as any,
      autoSave: true,
    });

    expect(updateEvaluation.mock.calls[0][1].status).toBe("draft");
  });

  it("用户主动提交时，状态应正常变为已提交", async () => {
    getEvaluationById.mockResolvedValue({ ...baseEvaluation, status: "draft" });
    const caller = appRouter.createCaller(supervisorContext());

    await caller.evaluations.update({
      id: 100,
      data: { courseId: 10, status: "submitted" } as any,
    });

    expect(updateEvaluation.mock.calls[0][1].status).toBe("submitted");
  });
});

describe("R11：评价提交后应同步听课计划状态", () => {
  it("草稿转为已提交时，应把听课计划标记为已评价", async () => {
    getEvaluationById.mockResolvedValue({ ...baseEvaluation, status: "draft" });
    const caller = appRouter.createCaller(supervisorContext());

    await caller.evaluations.update({
      id: 100,
      data: { courseId: 10, actualWeek: 3, status: "submitted" } as any,
    });

    expect(markListeningPlanCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ supervisorId: 2, courseId: 10, actualWeek: 3 })
    );
  });

  it("新建评价直接提交时，也应同步听课计划状态", async () => {
    const caller = appRouter.createCaller(supervisorContext());

    await caller.evaluations.create({
      courseId: 10,
      actualWeek: 5,
      status: "submitted",
    } as any);

    expect(markListeningPlanCompleted).toHaveBeenCalledWith(
      expect.objectContaining({ supervisorId: 2, courseId: 10, actualWeek: 5 })
    );
  });

  it("仅保存草稿时，不应改动听课计划状态", async () => {
    getEvaluationById.mockResolvedValue({ ...baseEvaluation, status: "draft" });
    const caller = appRouter.createCaller(supervisorContext());

    await caller.evaluations.update({
      id: 100,
      data: { courseId: 10, status: "draft" } as any,
    });

    expect(markListeningPlanCompleted).not.toHaveBeenCalled();
  });

  it("已提交的评价被自动保存时，不应重复同步听课计划", async () => {
    getEvaluationById.mockResolvedValue({ ...baseEvaluation, status: "submitted" });
    const caller = appRouter.createCaller(supervisorContext());

    await caller.evaluations.update({
      id: 100,
      data: { courseId: 10 } as any,
      autoSave: true,
    });

    expect(markListeningPlanCompleted).not.toHaveBeenCalled();
  });
});
