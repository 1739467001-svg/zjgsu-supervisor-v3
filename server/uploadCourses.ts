import { Router } from "express";
import multer from "multer";
import { createHash } from "node:crypto";
import { eq, inArray } from "drizzle-orm";
import { courses, courseEvaluations, listeningPlans, semesters } from "../drizzle/schema";
import { getDb } from "./db";
import { sdk } from "./_core/sdk";
import { ENV } from "./_core/env";
import { hasAnyRole } from "@shared/roles";
import { isPasswordResetRequired } from "./passwords";
import { mergeDuplicateCourses, parseCourseWorkbook } from "./courseImport";
import { courseUploadPlan, signUploadPreview, verifyUploadPreview, uploadFingerprint, type ExistingCourse } from "./courseUploadPlan";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024, files: 1, fields: 4 }, fileFilter: (_req, file, cb) => cb(null, /\.xlsx?$/i.test(file.originalname)) });
router.post("/api/upload-courses", async (req, res, next) => {
  try {
    const user = await sdk.authenticateRequest(req);
    if (!hasAnyRole(user, ["graduate_admin", "admin"]) || isPasswordResetRequired(user.password)) { res.status(403).json({ success: false, message: "请先修改初始密码；课表导入仅限研究生院主管或管理员" }); return; }
    res.locals.actor = user.id;
    next();
  } catch { res.status(401).json({ success: false, message: "请先登录" }); }
}, (req, res, next) => upload.single("file")(req, res, error => {
  if (error) { res.status(400).json({ success: false, message: "上传失败，请检查文件格式及20MB大小限制" }); return; }
  next();
}), async (req, res) => {
  try {
    if (!req.file) throw new Error("请选择 .xls 或 .xlsx 课表文件");
    if (!["preview", "apply"].includes(req.body.action) || !["standard", "mba"].includes(req.body.format)) throw new Error("请选择对应的课表入口并先预览");
    const semesterId = Number(req.body.semesterId);
    if (!Number.isInteger(semesterId) || semesterId < 1) throw new Error("请选择有效学期");
    const db = await getDb();
    if (!db) throw new Error("数据库连接失败");
    const result = await db.transaction(async tx => {
      // 同一学期的导入串行处理；学期启用操作亦锁定 semesters 表。
      const semester = (await tx.select().from(semesters).where(eq(semesters.id, semesterId)).for("update"))[0];
      if (!semester?.isActive) throw new Error("只允许导入当前学期，请刷新后重新预览");
      const parsed = parseCourseWorkbook(req.file!.buffer, { semesterStartDate: semester.startDate, totalWeeks: semester.totalWeeks });
      if (parsed.format !== req.body.format) throw new Error("文件格式与上传入口不一致");
      const incoming = mergeDuplicateCourses(parsed.courses).merged;
      if (!incoming.length || incoming.some(course => course.academicYear !== semester.academicYear || course.semester !== semester.name)) throw new Error("课表无有效课程或所属学期与目标不一致");
      const existing = await tx.select().from(courses).where(eq(courses.semesterId, semesterId)).orderBy(courses.id).for("update");
      const ids = existing.map(course => course.id);
      const evaluations = ids.length ? await tx.select({ id: courseEvaluations.id, courseId: courseEvaluations.courseId }).from(courseEvaluations).where(inArray(courseEvaluations.courseId, ids)).orderBy(courseEvaluations.id).for("update") : [];
      const plans = ids.length ? await tx.select({ id: listeningPlans.id, courseId: listeningPlans.courseId }).from(listeningPlans).where(inArray(listeningPlans.courseId, ids)).orderBy(listeningPlans.id).for("update") : [];
      const plan = courseUploadPlan(incoming, existing as ExistingCourse[], new Set([...evaluations, ...plans].map(row => row.courseId)), parsed.format);
      const binding = { file: createHash("sha256").update(req.file!.buffer).digest("hex"), state: uploadFingerprint({ semester, existing, evaluations, plans }), actor: res.locals.actor as number, semesterId, format: parsed.format };
      const summary = { sourceRows: parsed.sourceRows, total: incoming.length, inserted: plan.inserts.length, updated: plan.updates.length, unchanged: plan.unchanged, preserved: plan.preserved, conflicts: plan.conflicts, warnings: parsed.warnings };
      if (req.body.action === "preview") return { success: true, applied: false, message: "预览完成，尚未写入课表", summary, previewToken: signUploadPreview(binding, ENV.cookieSecret) };
      verifyUploadPreview(String(req.body.previewToken || ""), binding, ENV.cookieSecret);
      if (plan.conflicts.length) throw new Error("存在课程关联冲突，未写入任何数据，请按预览清单核实");
      for (const item of plan.updates) await tx.update(courses).set({ ...item.data, semesterId }).where(eq(courses.id, item.id));
      for (let index = 0; index < plan.inserts.length; index += 100) await tx.insert(courses).values(plan.inserts.slice(index, index + 100).map(course => ({ ...course, semesterId })));
      return { success: true, applied: true, message: "课程导入完成。旧课表已归档保留，未删除任何历史数据；已有评价或计划的课程未覆盖。", summary };
    });
    res.json(result);
  } catch (error) {
    // 不把数据库连接串或内部 SQL 错误返回到页面。
    const message = error instanceof Error ? error.message : "导入失败";
    const expected = /课表|课程|预览|文件|学期|上传|请选择|会话密钥/.test(message);
    res.status(400).json({ success: false, message: expected ? message : "导入失败，事务已回滚；请联系管理员核查" });
  }
});
export default router;
