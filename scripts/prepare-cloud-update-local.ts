/** 已有双学期云端快照升级演练，只读恢复源，只写全新隔离克隆。 */
import mysql from "mysql2/promise";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
const [source, roster] = process.argv.slice(2);
if (!/^zjgsu_restore_20261007_[a-f0-9]{10}$/.test(source || "") || !roster) throw new Error("需独立恢复源及正式名单");
const root = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root", dateStrings: true });
const suffix = randomBytes(5).toString("hex"), target = `zjgsu_history_test_${suffix}`, account = `cloud_${suffix}`, password = randomBytes(32).toString("hex");
const digest = (rows: unknown) => createHash("sha256").update(JSON.stringify(rows)).digest("hex");
try {
  const [terms] = await root.query<any[]>(`SELECT id,academicYear,name,startDate,totalWeeks,isActive FROM \`${source}\`.semesters ORDER BY id`);
  if (terms.length !== 2 || terms[0].academicYear !== "2025-2026" || terms[0].name !== "第二学期" || terms[1].academicYear !== "2026-2027" || terms[1].name !== "第一学期" || terms[1].isActive !== 1) throw new Error("云端学期状态变化，停止迁移");
  const [tableRows] = await root.query<any[]>(`SHOW TABLES FROM \`${source}\``);
  const tables = tableRows.map(row => String(Object.values(row)[0]));
  const originals: Record<string,any[]> = {};
  await root.query(`CREATE DATABASE \`${target}\``);
  for (const table of tables) {
    if (!/^[a-z0-9_]+$/.test(table)) throw new Error("表名不符合隔离要求");
    originals[table] = (await root.query<any[]>(`SELECT * FROM \`${source}\`.\`${table}\` ORDER BY id`))[0];
    await root.query(`CREATE TABLE \`${target}\`.\`${table}\` LIKE \`${source}\`.\`${table}\``);
    await root.query(`INSERT INTO \`${target}\`.\`${table}\` SELECT * FROM \`${source}\`.\`${table}\``);
  }
  const [columns] = await root.query<any[]>(`SHOW COLUMNS FROM \`${target}\`.semesters`);
  if (!columns.some(c => c.Field === "mbaStartDate")) await root.query(`ALTER TABLE \`${target}\`.semesters ADD mbaStartDate varchar(10) NULL`);
  if (!columns.some(c => c.Field === "mbaTotalWeeks")) await root.query(`ALTER TABLE \`${target}\`.semesters ADD mbaTotalWeeks int NULL`);
  // 仅已确认秋季配置改变；课程、评价、计划及历史原记录全部保留。
  await root.query(`UPDATE \`${target}\`.semesters SET startDate='2026-09-14',mbaStartDate='2026-09-07',mbaTotalWeeks=18,updatedAt=updatedAt WHERE id=2 AND academicYear='2026-2027' AND name='第一学期'`);
  await root.query(`CREATE USER '${account}'@'127.0.0.1' IDENTIFIED BY ?`,[password]);
  await root.query(`GRANT SELECT,INSERT,UPDATE ON \`${target}\`.* TO '${account}'@'127.0.0.1'`);
  const child = spawn("pnpm",["exec","tsx","scripts/import-users.ts",roster,"--apply"],{env:{...process.env,DATABASE_URL:`mysql://${account}:${password}@127.0.0.1:3306/${target}`,DOTENV_CONFIG_PATH:"/dev/null"},stdio:["ignore","ignore","ignore"]});
  if ((await once(child,"exit"))[0] !== 0) throw new Error("正式人员工具对账失败，克隆保留核查");
  const preserved: Record<string,boolean> = {};
  for (const table of tables) {
    const nowSource = (await root.query<any[]>(`SELECT * FROM \`${source}\`.\`${table}\` ORDER BY id`))[0];
    if (digest(nowSource) !== digest(originals[table])) throw new Error("恢复源意外变化");
    const candidate = (await root.query<any[]>(`SELECT * FROM \`${target}\`.\`${table}\` ORDER BY id`))[0];
    if (table === "users") preserved[table] = originals[table].every(old => candidate.some(u => u.id === old.id && u.employeeId === old.employeeId && u.password === old.password));
    else if (table === "semesters") preserved[table] = candidate.length === 2 && originals[table].every(old => Object.entries(old).every(([key,value]) => old.id === 2 && key === "startDate" || candidate.find(r=>r.id===old.id)?.[key] === value));
    else preserved[table] = digest(candidate) === digest(originals[table]);
    if (!preserved[table]) throw new Error(`原字段留存失败：${table}`);
  }
  const report = { source, candidate: target, sourceUnchanged: true, preserved, counts: Object.fromEntries(Object.entries(originals).map(([k,v])=>[k,v.length])), result: "PASS" };
  fs.writeFileSync("tmp/acceptance/cloud-20261014/upgrade-report.json",JSON.stringify(report,null,2));
  console.log(JSON.stringify(report));
} catch(e) { console.error(e instanceof Error && !("sql" in e) ? e.message : "隔离升级失败，敏感内容未输出"); process.exitCode=1; }
finally { await root.query(`DROP USER IF EXISTS '${account}'@'127.0.0.1'`); await root.end(); }
