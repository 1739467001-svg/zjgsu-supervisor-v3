/** 原件只读，恢复到全新隔离库；只输出计数和校验值，保留所有历史备份表。 */
import fs from "node:fs";
import { gunzipSync } from "node:zlib";
import { createHash, randomBytes } from "node:crypto";
import mysql from "mysql2/promise";
import { parsePersonnelWorkbook } from "./import-users";
const [file, roster] = process.argv.slice(2);
if (!file || !roster) throw new Error("需要单库sql.gz及正式名单路径");
const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
const original = fs.readFileSync(file), source = (file.endsWith(".gz") ? gunzipSync(original) : original).toString();
// 只去掉恢复目标指令，不改写任何表、字段、行值；受限恢复账号无权访问原库。
const dump = source.replace(/^CREATE DATABASE[^\n]*;\s*$/gm, "").replace(/^USE `zjgsu_supervisor`;\s*$/gm, "");
if (/\b(?:CREATE DATABASE|USE\s+`|GRANT|CREATE USER|DEFINER|OUTFILE|LOAD DATA|CREATE TRIGGER|CREATE PROCEDURE)\b/i.test(dump)) throw new Error("备份含额外执行指令，停止自动恢复");
const suffix = randomBytes(5).toString("hex"), database = `zjgsu_restore_20261007_${suffix}`, account = `restore_${suffix}`, password = randomBytes(32).toString("hex");
const root = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root" });
let conn: mysql.Connection | undefined;
try {
  await root.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await root.query(`CREATE USER '${account}'@'localhost' IDENTIFIED BY ?`, [password]);
  await root.query(`GRANT ALL ON \`${database}\`.* TO '${account}'@'localhost'`);
  conn = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: account, password, database, multipleStatements: true, dateStrings: true });
  await conn.query(dump);
  const [tableRows] = await conn.query<any[]>("SHOW TABLES");
  const tables = tableRows.map(r => String(Object.values(r)[0])).sort(), results: any[] = [];
  for (const table of tables) {
    const [rows] = await conn.query<any[]>(`SELECT * FROM \`${table}\` ORDER BY id`);
    results.push({ table, rows: rows.length, sha256: digest(JSON.stringify(rows)) });
  }
  const [terms] = await conn.query<any[]>("SELECT academicYear, semester, COUNT(*) AS courses FROM courses GROUP BY academicYear, semester");
  const integrity: Record<string, number> = {};
  for (const [label, query] of Object.entries({
    evaluationMissingCourse: "SELECT COUNT(*) n FROM course_evaluations e LEFT JOIN courses c ON e.courseId=c.id WHERE c.id IS NULL",
    evaluationMissingAuthor: "SELECT COUNT(*) n FROM course_evaluations e LEFT JOIN users u ON e.supervisorId=u.id WHERE u.id IS NULL",
    evaluationMissingPlan: "SELECT COUNT(*) n FROM course_evaluations e LEFT JOIN listening_plans p ON e.planId=p.id WHERE e.planId IS NOT NULL AND p.id IS NULL",
    planMissingCourse: "SELECT COUNT(*) n FROM listening_plans p LEFT JOIN courses c ON p.courseId=c.id WHERE c.id IS NULL",
    planMissingAuthor: "SELECT COUNT(*) n FROM listening_plans p LEFT JOIN users u ON p.supervisorId=u.id WHERE u.id IS NULL",
    evaluationPlanMismatch: "SELECT COUNT(*) n FROM course_evaluations e JOIN listening_plans p ON e.planId=p.id WHERE e.courseId<>p.courseId OR e.supervisorId<>p.supervisorId",
  })) { const [r] = await conn.query<any[]>(query); integrity[label] = Number(r[0].n); }
  const people = parsePersonnelWorkbook(roster);
  const [users] = await conn.query<any[]>("SELECT id,employeeId FROM users");
  const ids = new Set(users.map(r => String(r.employeeId)));
  const groups: Record<string, number> = {};
  for (const p of people.people) { const k = `${p.role}+${p.extraRoles.join(",")}:${p.supervisorScope}`; groups[k] = (groups[k] || 0) + 1; }
  const fu = people.people.find(p => p.name === "傅培华");
  const report = { source: file, sourceSha256: digest(original), database, tables: results, courseTerms: terms, integrity,
    roster: { source: roster, sha256: digest(fs.readFileSync(roster)), uniquePeople: people.people.length, mergedRows: people.mergedCount, problems: people.problems.length, dual: people.people.filter(p => p.extraRoles.length).length, groups, fuRoles: fu ? [fu.role, ...fu.extraRoles] : [], existingPeople: people.people.filter(p => ids.has(p.employeeId)).length, missingPeople: people.people.filter(p => !ids.has(p.employeeId)).length, existingOutsideRoster: users.filter(u => !people.people.some(p => p.employeeId === String(u.employeeId))).length },
    result: Object.values(integrity).some(n => n) ? "RESTORED_WITH_UNRESOLVED_LINKS" : "RESTORED" };
  if (digest(fs.readFileSync(file)) !== digest(original)) throw new Error("原备份校验变化");
  fs.mkdirSync("tmp/acceptance", { recursive: true });
  fs.writeFileSync(`tmp/acceptance/backup-${database}.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} catch { console.error("恢复核验未完成，未输出SQL或敏感数据；独立库保留供核查"); process.exitCode = 1; }
finally { await conn?.end(); await root.query(`DROP USER IF EXISTS '${account}'@'localhost'`); await root.end(); }
