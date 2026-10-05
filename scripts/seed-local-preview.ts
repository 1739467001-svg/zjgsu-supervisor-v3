/** 只允许空的专用本地预览库；不复用环境连接串、不清空现有数据。 */
import mysql from "mysql2/promise";
const db = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root", database: "zjgsu_preview_20261004" });
try {
  for (const table of ["users", "semesters", "courses", "course_evaluations", "listening_plans", "notifications"]) {
    const [rows] = await db.query(`SELECT COUNT(*) AS n FROM \`${table}\``);
    if ((rows as any[])[0].n !== 0) throw new Error("预览库不是空库，拒绝覆盖");
  }
  await db.beginTransaction();
  const roles = [
    ["admin", [], "school"], ["graduate_admin", [], "school"],
    ["supervisor_expert", [], "school"], ["supervisor_expert", [], "college"],
    ["college_secretary", [], "college"],
    ["graduate_admin", ["supervisor_expert"], "school"],
    ["supervisor_expert", ["college_secretary"], "college"],
  ];
  for (const [index, [role, extra, scope]] of roles.entries()) {
    const id = `local-test-${index + 1}`;
    await db.execute("INSERT INTO users (openId, employeeId, name, role, extraRoles, supervisorScope, college, loginMethod) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [id, id, `本地测试角色${index + 1}`, role, JSON.stringify(extra), scope, "工商管理学院", "employee_id"]);
  }
  for (const [year, name, start, active] of [["2025-2026", "第二学期", "2026-03-02", 0], ["2026-2027", "第一学期", "2026-09-14", 1]]) {
    const [result] = await db.execute("INSERT INTO semesters (academicYear, name, startDate, totalWeeks, isActive) VALUES (?, ?, ?, 18, ?)", [year, name, start, active]);
    for (const college of ["工商管理学院", "MBA学院"]) {
      await db.execute("INSERT INTO courses (semesterId, academicYear, semester, college, courseName, teacher, weekday) VALUES (?, ?, ?, ?, ?, ?, ?)", [(result as any).insertId, year, name, college, `本地测试课程-${college}`, "虚构测试教师", "星期一"]);
    }
  }
  await db.commit();
  console.log("本地测试数据已建立：7 个角色账号、2 个学期、4 门虚构课程；未生成评价。");
} catch (error) {
  await db.rollback();
  throw error;
} finally { await db.end(); }
