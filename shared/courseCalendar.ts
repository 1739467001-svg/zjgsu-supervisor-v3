import type { SemesterConfig } from "./dateUtils";

type CourseSemester = SemesterConfig & {
  mbaStartDate?: string | null;
  mbaTotalWeeks?: number | null;
};

export function validateMbaCalendar(semester: Pick<CourseSemester, "mbaStartDate" | "mbaTotalWeeks">): void {
  const { mbaStartDate: start, mbaTotalWeeks: weeks } = semester;
  if (start == null && weeks == null) return;
  const date = new Date(`${start}T00:00:00Z`);
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== start || date.getUTCDay() !== 1 || !Number.isInteger(weeks) || weeks! < 1 || weeks! > 30) {
    throw new Error("MBA 周历须同时填写真实的第一周周一日期和1至30的总周数");
  }
}

/** 全校统一校历；旧 MBA 字段仅为历史资料及旧版本回滚兼容而保留。 */
export function courseCalendar(semester: CourseSemester, college?: string | null): SemesterConfig {
  return { startDate: semester.startDate, totalWeeks: semester.totalWeeks };
}

export function validateUnifiedCalendar(semester: CourseSemester): void {
  validateMbaCalendar(semester);
  const date = new Date(`${semester.startDate}T00:00:00Z`);
  if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== semester.startDate || date.getUTCDay() !== 1) throw new Error("学期校历起点必须为有效的周一");
  if (semester.startDate.startsWith("2026-09-") && semester.startDate !== "2026-09-14") throw new Error("2026年秋季全校校历第一周须从2026-09-14开始");
  if ((semester.mbaStartDate != null && semester.mbaStartDate !== semester.startDate) || (semester.mbaTotalWeeks != null && semester.mbaTotalWeeks !== semester.totalWeeks)) throw new Error("MBA须与全校统一校历一致，不再设置独立周历");
}

export function courseWeekLabel(course: { weekNumbers: number[] | null; weekType: string | null }): string {
  if (!Array.isArray(course.weekNumbers)) return course.weekType || "未提供周次";
  if (!course.weekNumbers.length) return "周次待核查";
  const weeks = course.weekNumbers.filter(w => w > 0);
  return [course.weekNumbers.includes(0) ? course.weekType?.startsWith("开学前") ? course.weekType : "开学前（第0周）" : "", weeks.length ? `第${weeks.join("、")}周` : ""].filter(Boolean).join("；");
}
