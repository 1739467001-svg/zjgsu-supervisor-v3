import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { COOKIE_NAME } from "@shared/const";
import { hasAnyRole, getScopedCollege as resolveScopedCollege, MissingCollegeScopeError, isCollegeInScope, ASSIGNABLE_ROLES, type RoleAwareUser } from "@shared/roles";
import { publicUser } from "./publicUser";
import { isPasswordHash, verifyPassword, validateNewPassword } from "./passwords";
import { checkLoginThrottle, clearAccountLoginThrottle } from "./loginThrottle";
import { submissionErrors } from "@shared/evaluationValidation";
import { normalizeExtraRoles } from "@shared/roles";
import { calculateWeekFromDate } from "@shared/dateUtils";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import {
  completePendingPlanForEvaluation,
  createEvaluation,
  createSemester,
  getActiveSemester,
  getSemesterById,
  listSemesters,
  setActiveSemester,
  updateSemester,
  createListeningPlan,
  createNotification,
  deleteEvaluation,
  deleteListeningPlan,
  getAdminStats,
  getAllEvaluations,
  getAllUsers,
  getCourseById,
  getCourseEvaluationProgress,
  getAllCollegeEvaluationProgress,
  getCourses,
  getDistinctColleges,
  getDistinctTeachers,
  getEvaluationById,
  getEvaluationsBySupervisor,
  getListeningPlansBySupervisor,
  getUsedWeeksForCourse,
  getNotificationsByUser,
  getUnreadNotificationCount,
  getUserByEmployeeId,
  getUsersByRole,
  markAllNotificationsRead,
  markNotificationRead,
  updateEvaluation,
  getListeningPlanById,
  updateListeningPlan,
  getNotificationById,
  updateListeningPlanStatus,
  updateUserCollege,
  updateUserSupervisorScope,
  updateUserExtraRoles,
  updateUserPassword,
  updateUserRole,
  upsertUser,
  getUserById, saveAccountProfile, createUserAccount, disableUserAccount,
} from "./db";
import { canViewEvaluation, canMutateListeningPlan } from "@shared/evaluationAccess";
import { isWritableSemester } from "@shared/semesterArchive";
import { sdk } from "./_core/sdk";
import { generateEvaluationExcel, generateEvaluationPdfHtml, generateEvaluationPdfBuffer } from "./exportUtils";

// ============================================================
// 角色权限中间件
// ============================================================
function getScopedCollege(user: RoleAwareUser | null | undefined) {
  try {
    return resolveScopedCollege(user);
  } catch (error) {
    if (error instanceof MissingCollegeScopeError) {
      throw new TRPCError({ code: "FORBIDDEN", message: error.message });
    }
    throw error;
  }
}

const supervisorProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasAnyRole(ctx.user, ["supervisor_expert", "supervisor_leader", "graduate_admin", "admin"])) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要督导专家或以上权限" });
  }
  return next({ ctx });
});

const leaderProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasAnyRole(ctx.user, ["supervisor_leader", "graduate_admin", "admin"])) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要督导组长或以上权限" });
  }
  return next({ ctx });
});

const adminProcedure = protectedProcedure.use(({ ctx, next }) => {
  if (!hasAnyRole(ctx.user, ["graduate_admin", "admin"])) {
    throw new TRPCError({ code: "FORBIDDEN", message: "需要研究生院主管权限" });
  }
  return next({ ctx });
});

const semesterInput = z.object({ semesterId: z.number().int().positive().optional() }).optional();
const accountProfileSchema = z.object({
  role: z.enum(ASSIGNABLE_ROLES), extraRoles: z.array(z.enum(ASSIGNABLE_ROLES)).max(1),
  college: z.string().trim().max(128).nullable(), supervisorScope: z.enum(["school", "college"]),
});
async function accountAction(action: () => Promise<unknown>) {
  try { await action(); return { success: true }; }
  catch (error) {
    const message = error instanceof Error ? error.message : "";
    const safe = error instanceof MissingCollegeScopeError || /^(主角色不能重复作为附加角色|不能移除本人全部管理权限|不能停用本人账号|账号不存在|工号已存在，请修改原账号，不要重复创建|数据库连接失败|账号授权已变化，请重新登录)$/.test(message);
    throw new TRPCError({ code: "BAD_REQUEST", message: safe ? message : "账号操作未完成，请联系管理员核查" });
  }
}
async function selectedSemesterId(id?: number) {
  const semester = id == null ? await getActiveSemester() : await getSemesterById(id);
  if (!semester) throw new TRPCError({ code: "BAD_REQUEST", message: "请选择已建立档案的学期" });
  return semester.id;
}
async function requireCurrentSemester(recordId: number | null | undefined) {
  const active = await getActiveSemester();
  if (!isWritableSemester(recordId, active?.id)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "历史学期档案只读，不允许新增、修改或删除；请返回当前学期" });
  }
  return active!.id;
}

// ============================================================
// 评价表单 Zod Schema
// ============================================================
const evaluationSchema = z.object({
  courseId: z.number().int().positive("请选择有效课程"),
  planId: z.number().int().positive().optional(),
  listenDate: z.string().optional(),
  actualWeek: z.number().int().min(1).max(30).optional(),
  overallScore: z.number().min(1).max(5).optional(),
  // 定量评分（字段名与数据库 schema 保持一致）
  score_teaching_content: z.number().min(1).max(5).optional(),
  score_course_objective: z.number().min(1).max(5).optional(),
  score_reference_sharing: z.number().min(1).max(5).optional(),
  score_literature_humanities: z.number().min(1).max(5).optional(),
  score_teaching_organization: z.number().min(1).max(5).optional(),
  score_course_development: z.number().min(1).max(5).optional(),
  score_course_focus: z.number().min(1).max(5).optional(),
  score_language_logic: z.number().min(1).max(5).optional(),
  score_interaction: z.number().min(1).max(5).optional(),
  score_learning_preparation: z.number().min(1).max(5).optional(),
  score_teaching_quality: z.number().min(1).max(5).optional(),
  score_active_response: z.number().min(1).max(5).optional(),
  score_student_centered: z.number().min(1).max(5).optional(),
  score_research_teaching: z.number().min(1).max(5).optional(),
  score_learning_effect: z.number().min(1).max(5).optional(),
  score_learning_task_design: z.number().min(1).max(5).optional(),
  score_interaction_quality: z.number().min(1).max(5).optional(),
  score_method_diversity: z.number().min(1).max(5).optional(),
  score_equal_dialogue: z.number().min(1).max(5).optional(),
  score_pace_control: z.number().min(1).max(5).optional(),
  score_feedback: z.number().min(1).max(5).optional(),
  // 定性评价（字段名与数据库 schema 保持一致）
  highlights: z.string().optional(),
  suggestions: z.string().optional(),
  improvement_suggestion: z.string().optional(),
  development_suggestion: z.string().optional(),
  dimension_suggestion: z.string().optional(),
  resource_suggestion: z.string().optional(),
  status: z.enum(["draft", "submitted"]).optional(),
});

async function ensureCourseExists(courseId: number) {
  const course = await getCourseById(courseId);
  if (!course) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "课程不存在或已被删除，请重新选择课程" });
  }
  return course;
}

// 校验课程是否在用户的督导范围内（院级督导仅限本学院；校级督导/其他角色不限）
function ensureCourseInScope(user: RoleAwareUser, course: { college: string | null }) {
  const scopedCollege = getScopedCollege(user);
  if (!scopedCollege) return;
  if (!isCollegeInScope(scopedCollege, course.college)) {
    throw new TRPCError({ code: "FORBIDDEN", message: "院级督导仅可听课/评价本学院课程" });
  }
}

async function validateEvaluation(data: z.infer<typeof evaluationSchema>, course: Awaited<ReturnType<typeof ensureCourseExists>>, authorId: number) {
  const semester = await getActiveSemester();
  if (!semester) throw new TRPCError({ code: "BAD_REQUEST", message: "请先配置当前学期" });
  if (data.status === "submitted") {
    const errors = submissionErrors(data);
    if (errors.length) throw new TRPCError({ code: "BAD_REQUEST", message: errors.join("；") });
  }
  let week = data.actualWeek;
  if (Array.isArray(course.weekNumbers) && course.weekNumbers.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "课程尚无有效排课周次，请联系管理员核查原课表" });
  if (data.listenDate) {
    const date = data.listenDate;
    const parsedDate = new Date(`${date}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== date) throw new TRPCError({ code: "BAD_REQUEST", message: "听课日期无效" });
    const derived = calculateWeekFromDate(date, semester);
    if (!derived || (week != null && week !== derived)) throw new TRPCError({ code: "BAD_REQUEST", message: "听课日期和周次须属于当前学期且相互一致" });
    week = derived;
  }
  if (week != null && (week > semester.totalWeeks || (course.weekNumbers?.length && !course.weekNumbers.includes(week)))) throw new TRPCError({ code: "BAD_REQUEST", message: "该周不在课程排课范围内" });
  if (data.planId) {
    const plan = await getListeningPlanById(data.planId);
    if (!plan || plan.supervisorId !== authorId || plan.courseId !== course.id || plan.semesterId !== semester.id || (plan.planWeek != null && week != null && plan.planWeek !== week)) throw new TRPCError({ code: "BAD_REQUEST", message: "听课计划与评价作者、课程、学期或周次不一致" });
  }
  return week;
}

export const appRouter = router({
  system: systemRouter,

  // ============================================================
  // 认证
  // ============================================================
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user ? publicUser(opts.ctx.user) : null),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
    // 工号登录
    loginByEmployeeId: publicProcedure
      .input(z.object({ employeeId: z.string().trim().min(1).max(32), password: z.string().min(1).max(128) }))
      .mutation(async ({ input, ctx }) => {
        checkLoginThrottle(input.employeeId, ctx.req.ip || ctx.req.socket?.remoteAddress || "unknown");
        const user = await getUserByEmployeeId(input.employeeId.trim());
        if (!user) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "工号或密码错误，或账号不可用" });
        }

        // 验证密码（默认密码为工号）
        if (!hasAnyRole(user, ASSIGNABLE_ROLES) || !(await verifyPassword(input.password, user.password, user.employeeId || ""))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "工号或密码错误，或账号不可用" });
        }
        if (!isPasswordHash(user.password)) user.password = await updateUserPassword(user.id, input.password, input.password === user.employeeId);
        clearAccountLoginThrottle(input.employeeId);

        // 更新最后登录时间
        await upsertUser({ ...user, lastSignedIn: new Date() });

        // 签发JWT（使用sdk.createSessionToken，openId格式为emp_工号）
        const token = await sdk.createSessionToken(user.openId, { name: user.name || user.employeeId || "" });
        const cookieOptions = getSessionCookieOptions(ctx.req);
        ctx.res.cookie(COOKIE_NAME, token, cookieOptions);

        return { success: true, user: publicUser(user) };
      }),

    // 修改密码
    changePassword: protectedProcedure
      .input(z.object({ oldPassword: z.string().min(1).max(128), newPassword: z.string().min(10).max(128) }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        const dbUser = await getUserByEmployeeId(user.employeeId || "");
        if (!dbUser) throw new TRPCError({ code: "NOT_FOUND", message: "用户不存在" });
        if (!(await verifyPassword(input.oldPassword, dbUser.password, dbUser.employeeId || ""))) {
          throw new TRPCError({ code: "UNAUTHORIZED", message: "原密码错误" });
        }
        try { validateNewPassword(input.newPassword, dbUser.employeeId); } catch (error) { throw new TRPCError({ code: "BAD_REQUEST", message: (error as Error).message }); }
        // 使用专用的updateUserPassword函数，确保密码可靠写入数据库
        await updateUserPassword(dbUser.id, input.newPassword);
        ctx.res.clearCookie(COOKIE_NAME, { ...getSessionCookieOptions(ctx.req), maxAge: -1 });
        return { success: true };
      }),
  }),

  // ============================================================
  // 课程
  // ============================================================
  courses: router({
    list: protectedProcedure
      .input(
        z.object({
          college: z.string().optional(),
          campus: z.string().optional(),
          weekday: z.string().optional(),
          week: z.number().optional(),
          teacher: z.string().optional(),
          courseName: z.string().optional(),
          page: z.number().default(1),
          pageSize: z.number().default(20),
          semesterId: z.number().int().positive().optional(),
        })
      )
      .query(async ({ input, ctx }) => {
        // 学院教学秘书 / 院级督导 只能查看本学院课程
        const user = ctx.user!;
        const scopedCollege = getScopedCollege(user);
        const college = scopedCollege || input.college;
        return getCourses({ ...input, college, semesterId: await selectedSemesterId(input.semesterId) });
      }),

    getById: protectedProcedure.input(z.number()).query(async ({ input, ctx }) => {
      if (input <= 0) return null;
      const course = await getCourseById(input);
      if (course) ensureCourseInScope(ctx.user!, course);
      return course || null;
    }),

    getColleges: protectedProcedure.input(semesterInput).query(async ({ input, ctx }) => {
      const colleges = await getDistinctColleges(await selectedSemesterId(input?.semesterId));
      const scope = getScopedCollege(ctx.user);
      return scope ? colleges.filter(college => isCollegeInScope(scope, college)) : colleges || [];
    }),

    getTeachers: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .query(async ({ input, ctx }) => {
        const teachers = await getDistinctTeachers(getScopedCollege(ctx.user) || input.college, await selectedSemesterId(input.semesterId));
        return teachers || [];
      }),
  }),

  // ============================================================
  // 听课计划
  // ============================================================
  plans: router({
    create: supervisorProcedure
      .input(
        z.object({
          courseId: z.number(),
          planWeek: z.number().optional(),
          note: z.string().optional(),
        })
      )
      .mutation(async ({ input, ctx }) => {
        const course = await ensureCourseExists(input.courseId);
        ensureCourseInScope(ctx.user!, course);
        const activeSemester = await getActiveSemester();
        await requireCurrentSemester(course.semesterId);
        if (Array.isArray(course.weekNumbers) && course.weekNumbers.length === 0) throw new TRPCError({ code: "BAD_REQUEST", message: "课程尚无有效排课周次，请联系管理员核查原课表" });
        if (input.planWeek != null && (!Number.isInteger(input.planWeek) || input.planWeek < 1 || input.planWeek > activeSemester!.totalWeeks || (course.weekNumbers?.length && !course.weekNumbers.includes(input.planWeek)))) throw new TRPCError({ code: "BAD_REQUEST", message: "计划周次不在课程排课范围内" });
        return createListeningPlan({
          supervisorId: ctx.user!.id,
          courseId: input.courseId,
          semesterId: activeSemester?.id,
          planWeek: input.planWeek,
          note: input.note,
          status: "pending",
        });
      }),

    myPlans: supervisorProcedure.input(semesterInput).query(async ({ ctx, input }) => {
      // 只返回当前学期的计划，避免混入往期遗留
      return getListeningPlansBySupervisor(ctx.user!.id, await selectedSemesterId(input?.semesterId));
    }),

    updateStatus: supervisorProcedure
      .input(z.object({ planId: z.number(), status: z.enum(["pending", "completed", "cancelled"]) }))
      .mutation(async ({ input, ctx }) => {
        // 只验「是不是督导」不够：那样任何督导都能改别人的计划
        const plan = await getListeningPlanById(input.planId);
        if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
        if (!canMutateListeningPlan(ctx.user, plan)) throw new TRPCError({ code: "FORBIDDEN" });
        ensureCourseInScope(ctx.user!, await ensureCourseExists(plan.courseId));
        await requireCurrentSemester(plan.semesterId);
        await updateListeningPlanStatus(input.planId, input.status);
        return { success: true };
      }),

    update: supervisorProcedure
      .input(z.object({ planId: z.number().int().positive(), planWeek: z.number().int().positive().nullable(), note: z.string().trim().max(1000) }))
      .mutation(async ({ input, ctx }) => {
        const plan = await getListeningPlanById(input.planId);
        if (!plan) throw new TRPCError({ code: "NOT_FOUND", message: "计划不存在" });
        if (plan.supervisorId !== ctx.user!.id) throw new TRPCError({ code: "FORBIDDEN", message: "只能修改本人的听课计划" });
        const course = await ensureCourseExists(plan.courseId);
        ensureCourseInScope(ctx.user!, course);
        await requireCurrentSemester(plan.semesterId);
        const semester = await getActiveSemester();
        if (plan.status !== "pending") throw new TRPCError({ code: "BAD_REQUEST", message: "只有待听课计划可以修改" });
        if ((Array.isArray(course.weekNumbers) && !course.weekNumbers.length) || (input.planWeek != null && (input.planWeek > semester!.totalWeeks || (course.weekNumbers?.length && !course.weekNumbers.includes(input.planWeek))))) throw new TRPCError({ code: "BAD_REQUEST", message: "计划周次不在课程排课范围内" });
        try { await updateListeningPlan(input.planId, { planWeek: input.planWeek, note: input.note }); }
        catch (error) { const message = error instanceof Error ? error.message : ""; throw new TRPCError({ code: "BAD_REQUEST", message: /只有尚未关联|该周已有|历史档案只读/.test(message) ? message : "计划未修改，请刷新后重试" }); }
        return { success: true };
      }),

    delete: supervisorProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
      const plan = await getListeningPlanById(input);
      if (!plan) throw new TRPCError({ code: "NOT_FOUND" });
      if (!canMutateListeningPlan(ctx.user, plan)) throw new TRPCError({ code: "FORBIDDEN" });
      ensureCourseInScope(ctx.user!, await ensureCourseExists(plan.courseId));
      await requireCurrentSemester(plan.semesterId);
      await deleteListeningPlan(input);
      return { success: true };
    }),
    getUsedWeeks: supervisorProcedure
      .input(z.object({ courseId: z.number() }))
      .query(async ({ input, ctx }) => {
        ensureCourseInScope(ctx.user!, await ensureCourseExists(input.courseId));
        return getUsedWeeksForCourse(ctx.user!.id, input.courseId);
      }),
  }),

  // ============================================================
  // 课程评价
  // ============================================================
  evaluations: router({
    create: supervisorProcedure.input(evaluationSchema).mutation(async ({ input, ctx }) => {
      const course = await ensureCourseExists(input.courseId);
      ensureCourseInScope(ctx.user!, course);

      const activeSemester = await getActiveSemester();
      await requireCurrentSemester(course.semesterId);
      const actualWeek = await validateEvaluation(input, course, ctx.user!.id);
      const evaluation = await createEvaluation({
        ...input,
        supervisorId: ctx.user!.id,
        semesterId: activeSemester?.id,
        actualWeek,
        listenDate: input.listenDate ? new Date(input.listenDate) : undefined,
      });

      // 如果提交评价，发送通知
      if (input.status === "submitted" && evaluation) {
        // 同步关联的听课计划状态为"已评价"，避免待听课列表仍显示该课程
        const matchedPlanId = await completePendingPlanForEvaluation(ctx.user!.id, input.courseId, actualWeek ?? null);
        if (matchedPlanId && !evaluation.planId) {
          await updateEvaluation(evaluation.id, { planId: matchedPlanId });
        }

        // 通知研究生院主管
        const admins = await getUsersByRole("graduate_admin");
        for (const admin of admins) {
          await createNotification({
            recipientId: admin.id,
            senderId: ctx.user!.id,
            type: "evaluation_complete",
            title: "新督导评价提交",
            content: `${ctx.user!.name} 完成了对 ${course?.courseName || "课程"} (${course?.teacher || ""}) 的督导评价`,
            evaluationId: evaluation.id,
          });
        }

        // 通知相关学院教学秘书
        if (course?.college) {
          const secretaries = await getUsersByRole("college_secretary");
          const collegeSecretaries = secretaries.filter(
            (s) => s.college && course.college && s.college.includes(course.college.replace(/（.*?）/g, "").replace(/\(.*?\)/g, ""))
          );
          for (const secretary of collegeSecretaries) {
            await createNotification({
              recipientId: secretary.id,
              senderId: ctx.user!.id,
              type: "evaluation_complete",
              title: "本学院课程督导评价",
              content: `${ctx.user!.name} 完成了对 ${course.courseName} (${course.teacher}) 的督导评价，请查看`,
              evaluationId: evaluation.id,
            });
          }
        }
      }

      return evaluation;
    }),

    update: supervisorProcedure
      .input(z.object({ id: z.number(), data: evaluationSchema }))
      .mutation(async ({ input, ctx }) => {
        const existing = await getEvaluationById(input.id);
        if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
        if (existing.supervisorId !== ctx.user!.id && !hasAnyRole(ctx.user, ["supervisor_leader", "graduate_admin", "admin"])) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const course = await ensureCourseExists(input.data.courseId);
        ensureCourseInScope(ctx.user!, course);
        await requireCurrentSemester(existing.semesterId);
        await requireCurrentSemester(course.semesterId);
        if (existing.courseId !== input.data.courseId) throw new TRPCError({ code: "BAD_REQUEST", message: "不能改变评价关联的原课程" });
        const actualWeek = await validateEvaluation({ ...existing, ...input.data, status: input.data.status || existing.status } as any, course, existing.supervisorId);
        await updateEvaluation(input.id, {
          ...input.data,
          actualWeek,
          listenDate: input.data.listenDate ? new Date(input.data.listenDate) : undefined,
        });

        // 首次提交（从草稿变为已提交）时，同步关联听课计划状态
        if (input.data.status === "submitted" && existing.status !== "submitted") {
          const matchedPlanId = await completePendingPlanForEvaluation(
            existing.supervisorId,
            input.data.courseId,
            input.data.actualWeek ?? existing.actualWeek ?? null
          );
          if (matchedPlanId && !existing.planId) {
            await updateEvaluation(input.id, { planId: matchedPlanId });
          }
        }
        return { success: true };
      }),

    delete: supervisorProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
      const existing = await getEvaluationById(input);
      if (!existing) throw new TRPCError({ code: "NOT_FOUND" });
      if (existing.supervisorId !== ctx.user!.id && !hasAnyRole(ctx.user, ["graduate_admin", "admin"])) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      ensureCourseInScope(ctx.user!, await ensureCourseExists(existing.courseId));
      await requireCurrentSemester(existing.semesterId);
      await deleteEvaluation(input);
      return { success: true };
    }),

    getById: protectedProcedure.input(z.number()).query(async ({ input, ctx }) => {
      const evaluation = await getEvaluationById(input);
      if (!evaluation) throw new TRPCError({ code: "NOT_FOUND" });

      const course = await getCourseById(evaluation.courseId);
      // 与列表、打印路由共用同一条判定：此前详情只拦了院级范围，
      // 校级督导专家只要知道别人的评价 ID 就能直接读到详情。
      if (!canViewEvaluation(ctx.user, evaluation, course)) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }

      const allUsers = await getAllUsers();
      const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);

      return { ...evaluation, course, supervisor };
    }),

    myEvaluations: supervisorProcedure.input(semesterInput).query(async ({ ctx, input }) => {
      return getEvaluationsBySupervisor(ctx.user!.id, await selectedSemesterId(input?.semesterId));
    }),

    // 督导组长/主管/学院秘书查看所有评价（院级范围自动限定本学院）；督导专家（无更高角色）只能查看自己的评价，
    // 注意：督导专家即使设置了学院范围（院级督导）也只影响其"可听课/评价哪些课程"，不代表可以查看其他人的评价记录
    allEvaluations: protectedProcedure
      .input(z.object({ college: z.string().optional(), supervisorId: z.number().optional(), semesterId: z.number().int().positive().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        const semesterId = await selectedSemesterId(input.semesterId);
        if (!canViewAll) {
          return getEvaluationsBySupervisor(user.id, semesterId);
        }
        const scopedCollege = getScopedCollege(user);
        return getAllEvaluations({ ...input, college: scopedCollege || input.college, semesterId });
      }),

    exportToExcel: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        const semesterId = await selectedSemesterId(input.semesterId);
        let evaluations;
        if (canViewAll) {
          const scopedCollege = getScopedCollege(user);
          evaluations = await getAllEvaluations({ college: scopedCollege || input.college, semesterId });
        } else if (hasAnyRole(user, ["supervisor_expert"])) {
          evaluations = await getEvaluationsBySupervisor(user.id, semesterId);
        } else {
          throw new TRPCError({ code: "FORBIDDEN" });
        }

        const allUsers = await getAllUsers();
        const enrichedEvaluations = await Promise.all(
          evaluations.map(async (evaluation) => {
            const course = await getCourseById(evaluation.courseId);
            const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
            return { ...evaluation, course, supervisor };
          })
        );

        const buffer = generateEvaluationExcel(enrichedEvaluations);
        const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        return { buffer: buffer.toString("base64"), filename: `evaluations_semester-${semesterId}_${todayStr}.xlsx` };
      }),

    exportToPdf: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        // 权限：研究生院主管/admin/督导组长 可导出全部，学院教学秘书/院级督导只能导出本学院，校级以外的督导专家只能导出本人记录
        if (!hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader", "supervisor_expert"])) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无导出权限" });
        }

        const canViewAll = hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"]);
        const semesterId = await selectedSemesterId(input.semesterId);
        let evaluations;
        if (canViewAll) {
          const scopedCollege = getScopedCollege(user);
          evaluations = await getAllEvaluations({ college: scopedCollege || input.college, semesterId });
        } else {
          evaluations = await getEvaluationsBySupervisor(user.id, semesterId);
        }

        const allUsers = await getAllUsers();
        const enrichedEvaluations = await Promise.all(
          evaluations.map(async (evaluation) => {
            const course = await getCourseById(evaluation.courseId);
            const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
            return { ...evaluation, course, supervisor };
          })
        );

        const pdfHtml = generateEvaluationPdfHtml(enrichedEvaluations);
        const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
        return { html: pdfHtml, filename: `evaluations_semester-${semesterId}_${todayStr}.pdf` };
      }),

    // 单份评价导出（Excel）
    exportSingleToExcel: protectedProcedure
      .input(z.object({ evalId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        if (!hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader", "supervisor_expert"])) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无导出权限" });
        }
        const evaluation = await getEvaluationById(input.evalId);
        if (!evaluation) throw new TRPCError({ code: "NOT_FOUND", message: "评价记录不存在" });
        const course = await getCourseById(evaluation.courseId);
        if (!canViewEvaluation(user, evaluation, course)) throw new TRPCError({ code: "FORBIDDEN", message: "无权限导出该评价" });
        const allUsers = await getAllUsers();
        const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
        const enriched = { ...evaluation, course, supervisor };
        const buffer = generateEvaluationExcel([enriched]);
        const courseName = (course?.courseName || "evaluation").replace(/[/\\?%*:|"<>]/g, "-");
        return { buffer: buffer.toString("base64"), filename: `评价_${courseName}.xlsx` };
      }),

    // 单份评价导出（PDF）
    exportSingleToPdf: protectedProcedure
      .input(z.object({ evalId: z.number() }))
      .mutation(async ({ input, ctx }) => {
        const user = ctx.user!;
        if (!hasAnyRole(user, ["graduate_admin", "admin", "college_secretary", "supervisor_leader", "supervisor_expert"])) {
          throw new TRPCError({ code: "FORBIDDEN", message: "无导出权限" });
        }
        const evaluation = await getEvaluationById(input.evalId);
        if (!evaluation) throw new TRPCError({ code: "NOT_FOUND", message: "评价记录不存在" });
        const course = await getCourseById(evaluation.courseId);
        if (!canViewEvaluation(user, evaluation, course)) throw new TRPCError({ code: "FORBIDDEN", message: "无权限导出该评价" });
        const allUsers = await getAllUsers();
        const supervisor = allUsers.find((u) => u.id === evaluation.supervisorId);
        const enriched = { ...evaluation, course, supervisor };
        const pdfBuffer = await generateEvaluationPdfBuffer([enriched]);
        const courseName = (course?.courseName || "evaluation").replace(/[/\\?%*:|"<>]/g, "-");
        return { buffer: pdfBuffer.toString("base64"), filename: `评价_${courseName}.pdf` };
      }),
  }),

  // ============================================================
  // 统计（研究生院主管）
  // ============================================================
   stats: router({
    adminDashboard: protectedProcedure.input(semesterInput).query(async ({ input, ctx }) => {
      if (!hasAnyRole(ctx.user, ["graduate_admin", "admin", "college_secretary"])) {
        throw new TRPCError({ code: "FORBIDDEN" });
      }
      const college = getScopedCollege(ctx.user!);
      const stats = await getAdminStats(await selectedSemesterId(input?.semesterId));
      if (!stats || !college) return stats;
      const rows = stats.semesterColleges.filter(row => isCollegeInScope(college, row.college));
      // 只返回授权学院的聚合数据，不能附带全校最近评价、人员或排行。
      return {
        semesterColleges: rows,
        totalCourses: rows.reduce((sum, row) => sum + row.totalCourses, 0),
        totalEvaluations: rows.reduce((sum, row) => sum + row.evaluationCount, 0),
      };
    }),
    collegeStats: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        // 此前这里没有任何角色门禁：任何登录用户不传 college 就能拿到全校所有评价。
        if (!hasAnyRole(user, ["supervisor_leader", "college_secretary", "graduate_admin", "admin"])) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        // 用 getScopedCollege 而不是直接比较主角色，附加角色与院级督导才会被认到
        const scopedCollege = getScopedCollege(user);
        const college = scopedCollege || input.college;
        const evals = await getAllEvaluations({ college, semesterId: await selectedSemesterId(input.semesterId) });
        return {
          total: evals.length,
          submitted: evals.filter((e) => e.status === "submitted").length,
          evaluatedCourses: new Set(evals.filter(e => e.status === "submitted").map(e => e.courseId)).size,
          evaluations: evals,
        };
      }),
    // 课程评价进度（学院秘书查本学院，主管查指定学院）
    courseProgress: protectedProcedure
      .input(z.object({ college: z.string().optional(), semesterId: z.number().int().positive().optional() }))
      .query(async ({ input, ctx }) => {
        const user = ctx.user!;
        // hasAnyRole / getScopedCollege 而不是直接比较 user.role：
        // 否则「主角色普通用户 + 附加角色研究生院主管」会被挡在外面
        if (!hasAnyRole(user, ["college_secretary", "graduate_admin", "admin"])) {
          throw new TRPCError({ code: "FORBIDDEN" });
        }
        const scopedCollege = getScopedCollege(user);
        return getCourseEvaluationProgress(scopedCollege || input.college, await selectedSemesterId(input.semesterId));
      }),
    // 全校各学院评价进度汇总（研究生院主管专用）
    allCollegeProgress: adminProcedure.input(semesterInput).query(async ({ input }) => {
      return getAllCollegeEvaluationProgress(await selectedSemesterId(input?.semesterId));
    }),
    // 与当前用户课程列表使用相同学院范围。
    courseCount: protectedProcedure.input(semesterInput).query(async ({ input, ctx }) => {
      const result = await getCourses({ page: 1, pageSize: 1, college: getScopedCollege(ctx.user) || undefined, semesterId: await selectedSemesterId(input?.semesterId) });
      return { total: result.total };
    }),
  }),

  // ============================================================
  // 通知
  // ============================================================
  notifications: router({
    list: protectedProcedure.query(async ({ ctx }) => {
      return getNotificationsByUser(ctx.user!.id);
    }),

    unreadCount: protectedProcedure.query(async ({ ctx }) => {
      return getUnreadNotificationCount(ctx.user!.id);
    }),

    markRead: protectedProcedure.input(z.number()).mutation(async ({ input, ctx }) => {
      // 不校验收件人的话，知道通知 ID 就能把别人的通知标为已读
      const notification = await getNotificationById(input);
      if (!notification) throw new TRPCError({ code: "NOT_FOUND" });
      if (notification.recipientId !== ctx.user!.id) throw new TRPCError({ code: "FORBIDDEN" });
      await markNotificationRead(input);
      return { success: true };
    }),

    markAllRead: protectedProcedure.mutation(async ({ ctx }) => {
      await markAllNotificationsRead(ctx.user!.id);
      return { success: true };
    }),
  }),

  // ============================================================
  // 学期管理（研究生院主管）
  // ============================================================
  semesters: router({
    // 当前学期：所有登录用户都需要（前端据此计算周次、限定可选日期范围）
    active: protectedProcedure.query(async () => {
      const s = await getActiveSemester();
      if (!s) return null;
      return { id: s.id, academicYear: s.academicYear, name: s.name, startDate: s.startDate, totalWeeks: s.totalWeeks };
    }),

    list: protectedProcedure.query(async () => listSemesters()),

    create: adminProcedure
      .input(
        z.object({
          academicYear: z.string().min(1, "请填写学年"),
          name: z.string().min(1, "请填写学期名称"),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "开始日期格式应为 YYYY-MM-DD"),
          totalWeeks: z.number().int().min(1).max(30),
        })
      )
      .mutation(async ({ input }) => {
        try {
          return await createSemester(input);
        } catch (err: any) {
          throw new TRPCError({ code: "BAD_REQUEST", message: err.message || "创建学期失败" });
        }
      }),

    update: adminProcedure
      .input(
        z.object({
          id: z.number(),
          startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "开始日期格式应为 YYYY-MM-DD").optional(),
          totalWeeks: z.number().int().min(1).max(30).optional(),
        })
      )
      .mutation(async ({ input }) => {
        const { id, ...rest } = input;
        await updateSemester(id, rest);
        return { success: true };
      }),

    setActive: adminProcedure.input(z.object({ id: z.number() })).mutation(async ({ input }) => {
      await setActiveSemester(input.id);
      return { success: true };
    }),
  }),

  // ============================================================
  // 用户管理（研究生院主管）
  // ============================================================
  users: router({
    create: adminProcedure.input(accountProfileSchema.extend({ employeeId: z.string().trim().min(1).max(32).regex(/^[\w-]+$/, "工号只能包含字母、数字、下划线或连字符"), name: z.string().trim().min(1).max(80), password: z.string().min(10).max(128) })).mutation(({ input }) => accountAction(async () => {
      validateNewPassword(input.password, input.employeeId);
      await createUserAccount(input);
    })),
    updateProfile: adminProcedure.input(accountProfileSchema.extend({ userId: z.number().int().positive() })).mutation(({ input, ctx }) => accountAction(async () => {
      const { userId, ...profile } = input;
      await saveAccountProfile(userId, profile, ctx.user!.id);
    })),
    resetPassword: adminProcedure.input(z.object({ userId: z.number().int().positive(), password: z.string().min(10).max(128) })).mutation(({ input }) => accountAction(async () => {
      const target = await getUserById(input.userId);
      if (!target) throw new Error("账号不存在");
      if (target.password?.startsWith("disabled$")) throw new Error("账号已停用，请使用启用功能设置新密码");
      validateNewPassword(input.password, target.employeeId);
      await updateUserPassword(input.userId, input.password, true);
    })),
    disable: adminProcedure.input(z.object({ userId: z.number().int().positive() })).mutation(({ input, ctx }) => accountAction(() => disableUserAccount(input.userId, ctx.user!.id))),
    activate: adminProcedure.input(z.object({ userId: z.number().int().positive(), password: z.string().min(10).max(128) })).mutation(({ input }) => accountAction(async () => {
      const target = await getUserById(input.userId);
      if (!target?.password?.startsWith("disabled$")) throw new Error("账号未停用或不存在");
      validateNewPassword(input.password, target.employeeId);
      await updateUserPassword(input.userId, input.password, true);
    })),
    list: adminProcedure.query(async () => {
      return getAllUsers();
    }),

    updateRole: adminProcedure
      .input(z.object({ userId: z.number(), role: z.enum(ASSIGNABLE_ROLES) }))
      .mutation(async ({ input, ctx }) => {
        const target = await getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND" });
        await accountAction(() => saveAccountProfile(target.id, { role: input.role, extraRoles: normalizeExtraRoles(target.extraRoles).filter(role => role !== input.role), college: target.college, supervisorScope: target.supervisorScope }, ctx.user!.id));
        return { success: true };
      }),

    // 更新附加角色（多角色切换用）
    updateExtraRoles: adminProcedure
      .input(z.object({ userId: z.number(), extraRoles: z.array(z.enum(ASSIGNABLE_ROLES)).max(1) }))
      .mutation(async ({ input, ctx }) => {
        const target = await getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND" });
        await accountAction(() => saveAccountProfile(target.id, { role: target.role, extraRoles: input.extraRoles, college: target.college, supervisorScope: target.supervisorScope }, ctx.user!.id));
        return { success: true };
      }),

    // 更新所属学院（学院教学秘书的管辖学院；对督导是人事归属学院）
    updateCollege: adminProcedure
      .input(z.object({ userId: z.number(), college: z.string().nullable() }))
      .mutation(async ({ input, ctx }) => {
        const target = await getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND" });
        await accountAction(() => saveAccountProfile(target.id, { role: target.role, extraRoles: normalizeExtraRoles(target.extraRoles), college: input.college, supervisorScope: target.supervisorScope }, ctx.user!.id));
        return { success: true };
      }),

    // 更新督导范围（校级=全校课程，院级=仅本学院）
    updateSupervisorScope: adminProcedure
      .input(z.object({ userId: z.number(), scope: z.enum(["school", "college"]) }))
      .mutation(async ({ input, ctx }) => {
        const target = await getUserById(input.userId);
        if (!target) throw new TRPCError({ code: "NOT_FOUND" });
        await accountAction(() => saveAccountProfile(target.id, { role: target.role, extraRoles: normalizeExtraRoles(target.extraRoles), college: target.college, supervisorScope: input.scope }, ctx.user!.id));
        return { success: true };
      }),

    getSupervisors: protectedProcedure.query(async () => {
      const experts = await getUsersByRole("supervisor_expert");
      const leaders = await getUsersByRole("supervisor_leader");
      return [...leaders, ...experts];
    }),
  }),
});

export type AppRouter = typeof appRouter;
