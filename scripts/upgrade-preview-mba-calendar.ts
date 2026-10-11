/** 仅对已确认的七人虚构预览库添加空列；不初始化、不改课表或历史配置。 */
import mysql from "mysql2/promise";
const db = "zjgsu_preview_20261004";
const root = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root" });
try {
  const [users] = await root.query<any[]>(`SELECT employeeId FROM \`${db}\`.users ORDER BY employeeId`);
  if (users.length !== 7 || users.some((u, i) => u.employeeId !== `local-test-${i + 1}`)) throw new Error("仅允许既有七人虚构预览库");
  const [columns] = await root.query<any[]>("SELECT column_name FROM information_schema.columns WHERE table_schema=? AND table_name='semesters'", [db]);
  const existing = new Set(columns.map(c => c.COLUMN_NAME ?? c.column_name));
  for (const [name, type] of [["mbaStartDate", "varchar(10)"], ["mbaTotalWeeks", "int"]]) {
    if (!existing.has(name)) await root.query(`ALTER TABLE \`${db}\`.semesters ADD COLUMN \`${name}\` ${type} NULL`);
  }
  if (process.argv.includes("--configure-confirmed-mba")) {
    const [courses] = await root.query<any[]>(`SELECT id,courseName,college FROM \`${db}\`.courses`);
    if (courses.some(c => !c.courseName.startsWith("本地测试课程-"))) throw new Error("出现非原虚构课程，停止配置");
    const [linked] = await root.query<any[]>(`SELECT (SELECT COUNT(*) FROM \`${db}\`.listening_plans p JOIN \`${db}\`.courses c ON p.courseId=c.id WHERE c.college='MBA学院') + (SELECT COUNT(*) FROM \`${db}\`.course_evaluations e JOIN \`${db}\`.courses c ON e.courseId=c.id WHERE c.college='MBA学院') n`);
    if (Number(linked[0].n)) throw new Error("虚构MBA课程已有关联，停止配置");
    await root.query(`UPDATE \`${db}\`.semesters SET mbaStartDate='2026-09-07',mbaTotalWeeks=18,updatedAt=updatedAt WHERE isActive=1 AND academicYear='2026-2027' AND name='第一学期' AND startDate='2026-09-14' AND mbaStartDate IS NULL AND mbaTotalWeeks IS NULL`);
    console.log("仅在原七人虚构库配置已确认MBA周历；未改课程、评价、计划或历史学期。");
  }
  console.log("七人虚构预览库已增加 MBA 周历空列；所有业务数据与历史配置保留。");
} finally { await root.end(); }
