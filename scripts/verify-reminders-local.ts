/** 真实站内提醒演练：只新建隔离虚构库，不启动定时器或连接生产。 */
import mysql from "mysql2/promise";
import { randomBytes } from "node:crypto";
const suffix = randomBytes(5).toString("hex");
const database = `zjgsu_reminder_test_${suffix}`, account = `reminder_${suffix}`;
const password = randomBytes(32).toString("hex");
const root = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root" });
let passed = 0, failed = false;
function assert(ok: unknown, label: string) { if (!ok) throw new Error(label); passed++; console.log(`通过：${label}`); }
try {
  await root.query(`CREATE DATABASE \`${database}\``);
  for (const table of ["semesters", "courses", "listening_plans", "notifications"]) await root.query(`CREATE TABLE \`${database}\`.\`${table}\` LIKE zjgsu_preview_20261004.\`${table}\``);
  await root.query(`CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`, [password]);
  await root.query(`GRANT SELECT,INSERT ON \`${database}\`.* TO '${account}'@'127.0.0.1'`);
  process.env.DATABASE_URL = `mysql://${account}:${password}@127.0.0.1:3306/${database}`;
  process.env.DOTENV_CONFIG_PATH = "/dev/null";
  await root.query(`INSERT INTO \`${database}\`.semesters (id,academicYear,name,startDate,totalWeeks,mbaStartDate,mbaTotalWeeks,isActive) VALUES (1,'2026-2027','第一学期','2026-09-14',18,'2026-09-07',18,1),(2,'2025-2026','第二学期','2026-03-02',19,NULL,NULL,0)`);
  for (const [id, college, semesterId] of [[1,"MBA学院",1],[2,"工商管理学院",1],[3,"MBA学院",2]] as const) {
    await root.query(`INSERT INTO \`${database}\`.courses (id,semesterId,college,courseName,teacher,weekday) VALUES (?,?,?,?,?,'星期六')`, [id,semesterId,college,`虚构提醒课程${id}`,"虚构教师"]);
  }
  for (const [courseId, semesterId, week, status] of [[1,1,1,"pending"],[1,1,2,"pending"],[2,1,1,"pending"],[2,1,2,"pending"],[3,2,1,"pending"],[1,1,1,"completed"]] as const) {
    await root.query(`INSERT INTO \`${database}\`.listening_plans (supervisorId,courseId,semesterId,planWeek,status) VALUES (1,?,?,?,?)`,[courseId,semesterId,week,status]);
  }
  const { sendListeningReminders } = await import("../server/scheduler");
  const messages = async () => (await root.query<any[]>(`SELECT * FROM \`${database}\`.notifications ORDER BY id`))[0];
  await sendListeningReminders(new Date("2026-09-11T04:00:00Z"));
  let rows = await messages();
  assert(rows.length === 1 && rows[0].content.includes("虚构提醒课程1") && rows[0].content.includes("第1周") && !rows[0].content.includes("虚构提醒课程2"), "9月12日MBA首周真实站内提醒，普通课尚未开始不提醒");
  assert(!rows[0].content.includes("虚构提醒课程3"), "历史学期计划不产生提醒");
  await sendListeningReminders(new Date("2026-09-18T04:00:00Z"));
  rows = await messages();
  assert(rows.length === 2 && rows[1].content.includes("《虚构提醒课程1》（第2周") && rows[1].content.includes("《虚构提醒课程2》（第1周"), "同一督导混合课程提醒各自准确周次");
  assert(rows[1].content.match(/虚构提醒课程/g)?.length === 2, "不包含错误周次、历史或已完成计划");
  await root.query(`UPDATE \`${database}\`.semesters SET mbaStartDate=NULL,mbaTotalWeeks=NULL WHERE id=1`);
  await sendListeningReminders(new Date("2026-09-11T04:00:00Z"));
  assert((await messages()).length === 2, "未配置MBA周历不猜测、不发送错误提醒");
  console.log(JSON.stringify({ database, passed, result: "PASS" }));
} catch (error) { failed = true; console.error(error instanceof Error ? error.message : "提醒验收失败"); }
finally { const { closeDb } = await import("../server/db"); await closeDb(); await root.query(`DROP USER IF EXISTS '${account}'@'127.0.0.1'`); await root.end(); }
process.exit(failed ? 1 : 0);
