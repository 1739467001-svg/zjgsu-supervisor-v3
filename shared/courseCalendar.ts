import { MBA_COLLEGE, normalizeCourseCollege } from "./colleges";
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

/** Only explicitly configured MBA dates apply; never infer historical calendars. */
export function courseCalendar(semester: CourseSemester, college?: string | null): SemesterConfig {
  if (normalizeCourseCollege(college ?? "") === MBA_COLLEGE && semester.mbaStartDate && semester.mbaTotalWeeks) {
    return { startDate: semester.mbaStartDate, totalWeeks: semester.mbaTotalWeeks };
  }
  return { startDate: semester.startDate, totalWeeks: semester.totalWeeks };
}
