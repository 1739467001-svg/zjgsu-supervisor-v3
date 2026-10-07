import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { courseKey, type ParsedCourse, type CourseFileFormat } from "./courseImport";

export type ExistingCourse = ParsedCourse & { id: number; semesterId: number | null };
const fields = ["academicYear", "semester", "college", "courseName", "courseType", "classroom", "classId", "teacher", "campus", "weekday", "weekType", "period", "customWeeks", "weekNumbers", "studentMajor", "studentCount"] as const;
function content(course: ParsedCourse) { return fields.map(field => course[field] ?? null); }
export function courseUploadPlan(incoming: ParsedCourse[], existing: ExistingCourse[], protectedIds: Set<number>, format: CourseFileFormat) {
  const keyMap = new Map<string, ExistingCourse>();
  for (const course of existing) {
    if (keyMap.has(courseKey(course))) throw new Error("当前学期存在重复课程标识，请先核查原有数据");
    keyMap.set(courseKey(course), course);
  }
  const inserts: ParsedCourse[] = [], updates: { id: number; data: ParsedCourse }[] = [], conflicts: string[] = [];
  let unchanged = 0;
  for (const course of incoming) {
    if ((course.college === "MBA学院") !== (format === "mba")) throw new Error("课表来源与所选入口不一致，请使用对应入口");
    const old = keyMap.get(courseKey(course));
    if (old) {
      if (JSON.stringify(content(old)) === JSON.stringify(content(course))) unchanged++;
      else if (protectedIds.has(old.id)) conflicts.push(`${course.college} / ${course.courseName}：已关联评价或计划，不允许覆盖`);
      else updates.push({ id: old.id, data: course });
    } else {
      const changedIdentity = existing.find(oldCourse => protectedIds.has(oldCourse.id) && oldCourse.college === course.college && oldCourse.courseName === course.courseName && oldCourse.classId === course.classId);
      if (changedIdentity) conflicts.push(`${course.college} / ${course.courseName}：与已评价课程相似但关键字段改变，请核实`);
      else inserts.push(course);
    }
  }
  return { inserts, updates, unchanged, conflicts, preserved: existing.filter(course => !incoming.some(row => courseKey(row) === courseKey(course))).length };
}
export const uploadFingerprint = (value: unknown) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");
export function signUploadPreview(payload: { file: string; state: string; actor: number; actorState: string; semesterId: number; format: CourseFileFormat }, secret: string) {
  if (secret.length < 32) throw new Error("会话密钥配置不完整，无法生成导入预览");
  const text = Buffer.from(JSON.stringify({ ...payload, expires: Date.now() + 10 * 60 * 1000 })).toString("base64url");
  return `${text}.${createHmac("sha256", secret).update(text).digest("base64url")}`;
}
export function verifyUploadPreview(token: string, expected: Parameters<typeof signUploadPreview>[0], secret: string) {
  const [text, mac, extra] = token.split(".");
  if (!text || !mac || extra || token.length > 2048 || secret.length < 32) throw new Error("导入预览无效，请重新预览");
  const signature = createHmac("sha256", secret).update(text).digest();
  const provided = Buffer.from(mac, "base64url");
  if (signature.length !== provided.length || !timingSafeEqual(signature, provided)) throw new Error("导入预览无效，请重新预览");
  const payload = JSON.parse(Buffer.from(text, "base64url").toString());
  if (payload.expires < Date.now() || Object.entries(expected).some(([key, value]) => payload[key] !== value)) throw new Error("文件、学期或数据库已变化，或预览已过期，请重新预览");
}
