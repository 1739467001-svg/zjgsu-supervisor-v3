/** 原Excel与历史兼容克隆只读对账；不导入、迁移、重归属或修改任何记录。 */
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import mysql, { type RowDataPacket } from "mysql2/promise";
import { courseKey, mergeDuplicateCourses, parseCourseWorkbook } from "../server/courseImport";
import { courseIssuesCsv } from "../shared/courseImportDiagnostics";

const [folder, database] = process.argv.slice(2);
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const storedKey = (c: RowDataPacket) => courseKey({
  college: String(c.college ?? ""), courseName: String(c.courseName ?? ""),
  teacher: String(c.teacher ?? ""), weekday: String(c.weekday ?? ""),
  period: String(c.period ?? ""), classroom: String(c.classroom ?? ""),
});

async function main() {
  assert(folder && path.isAbsolute(folder), "请提供原课表所在文件夹的绝对路径");
  assert(/^zjgsu_history_test_[a-f0-9]{10}$/.test(database ?? ""), "仅接受独立历史兼容测试库，拒绝生产库和虚构预览库");
  const root = await fs.realpath(folder);
  const out = path.resolve("tmp/acceptance/course-file-audit");
  await fs.mkdir(out, { recursive: true, mode: 0o700 });
  const conn = await mysql.createConnection({ socketPath: "/tmp/mysql.sock", user: "root", database });
  try {
    // MySQL在事务层禁止写入；本脚本所有业务查询亦仅为SELECT。
    await conn.query("SET TRANSACTION READ ONLY");
    await conn.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    const [semesters] = await conn.query<RowDataPacket[]>("SELECT id,academicYear,name,startDate,totalWeeks,isActive FROM semesters ORDER BY id");
    const [courses] = await conn.query<RowDataPacket[]>("SELECT * FROM courses ORDER BY id");
    const [evaluations] = await conn.query<RowDataPacket[]>("SELECT id,courseId,supervisorId,semesterId,planId,status FROM course_evaluations ORDER BY id");
    const [plans] = await conn.query<RowDataPacket[]>("SELECT id,courseId,supervisorId,semesterId FROM listening_plans ORDER BY id");
    const [users] = await conn.query<RowDataPacket[]>("SELECT id FROM users");
    const courseIds = new Map(courses.map(c => [c.id, c]));
    const userIds = new Set(users.map(u => u.id));
    const planIds = new Map(plans.map(p => [p.id, p]));
    const broken = evaluations.filter(e => {
      const c = courseIds.get(e.courseId), p = e.planId == null ? null : planIds.get(e.planId);
      return !c || !userIds.has(e.supervisorId) || c.semesterId !== e.semesterId ||
        (e.planId != null && (!p || p.courseId !== e.courseId || p.supervisorId !== e.supervisorId || p.semesterId !== e.semesterId));
    });
    const brokenPlans = plans.filter(p => !courseIds.has(p.courseId) || !userIds.has(p.supervisorId) || courseIds.get(p.courseId)!.semesterId !== p.semesterId);
    assert.equal(broken.length, 0, "评价课程、作者、计划或学期关联异常");
    assert.equal(brokenPlans.length, 0, "计划课程、作者或学期关联异常");
    const results = [];
    for (const s of semesters) {
      const suffix = s.name === "第一学期" ? "1" : s.name === "第二学期" ? "2" : null;
      assert(suffix, "无法明确对应学期目录，不猜测归属");
      const label = `${s.academicYear}-${suffix}`;
      const directory = path.join(root, label);
      const names = (await fs.readdir(directory)).filter(n => n.endsWith(".xls") && /课表|排课/.test(n)).sort();
      assert.equal(names.length, 2, `${label}需要恰好两份原xls，避免自行挑选文件`);
      const files = [], parsedCourses = [];
      for (const name of names) {
        const file = path.join(directory, name), bytes = await fs.readFile(file), before = hash(bytes);
        const parsed = parseCourseWorkbook(bytes, { semesterStartDate: s.startDate, totalWeeks: s.totalWeeks });
        assert(parsed.courses.every(c => c.academicYear === s.academicYear && c.semester === s.name), "原课表学期与目录、历史学期记录不一致；停止对账，不猜测归属");
        parsedCourses.push(...parsed.courses);
        const kinds = parsed.issues.reduce<Record<string, number>>((a, i) => { a[i.kind] = (a[i.kind] ?? 0) + 1; return a; }, {});
        files.push({ name, sha256: before, format: parsed.format, sourceRows: parsed.sourceRows, parsedCourses: parsed.courses.length, issues: parsed.issues.length, issueRows: new Set(parsed.issues.map(i => i.sourceRow)).size, kinds, originalTerms: [...new Set(parsed.courses.map(c => `${c.academicYear}/${c.semester}`))] });
        if (parsed.issues.length) await fs.writeFile(path.join(out, `${label}-${parsed.format}-核查.csv`), courseIssuesCsv(parsed.issues, parsed.sheetName ?? ""), { mode: 0o600 });
        assert.equal(hash(await fs.readFile(file)), before, "原文件内容发生变化，停止对账");
      }
      assert.equal(new Set(files.map(f => f.format)).size, 2, "必须包含MBA与非MBA两种格式");
      const merged = mergeDuplicateCourses(parsedCourses).merged;
      const stored = courses.filter(c => c.semesterId === s.id);
      const fileKeys = new Set(merged.map(courseKey)), storedKeys = new Set(stored.map(storedKey));
      const fileOnly = merged.filter(c => !storedKeys.has(courseKey(c)));
      const backupOnly = stored.filter(c => !fileKeys.has(storedKey(c)));
      const linkedIds = new Set([...evaluations, ...plans].filter(r => r.semesterId === s.id).map(r => r.courseId));
      const result = { semester: label, startDate: s.startDate, totalWeeks: s.totalWeeks, active: Boolean(s.isActive), files, parsedMergedCourses: merged.length, storedCourses: stored.length, storedUniqueKeys: storedKeys.size, matchingUniqueKeys: [...fileKeys].filter(k => storedKeys.has(k)).length, fileOnlyKeys: fileOnly.length, backupOnlyRows: backupOnly.length, backupOnlyLinkedRows: backupOnly.filter(c => linkedIds.has(c.id)).length, evaluations: evaluations.filter(e => e.semesterId === s.id).length, plans: plans.filter(p => p.semesterId === s.id).length };
      results.push(result);
      // 含真实课程的差异清单只在忽略目录保存，不公开推送。
      await fs.writeFile(path.join(out, `${label}-差异.json`), JSON.stringify({ result, fileOnly, backupOnly }, null, 2), { mode: 0o600 });
    }
    const report = { database, sourceFolder: root, readOnly: true, brokenEvaluations: broken.length, brokenPlans: brokenPlans.length, semesters: results };
    await fs.writeFile(path.join(out, "report.json"), JSON.stringify(report, null, 2), { mode: 0o600 });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await conn.end();
  }
}
main().catch(error => { console.error(error instanceof assert.AssertionError ? error.message : "只读课表对账失败：请核对原文件、隔离库及关联；未输出配置或人员信息"); process.exitCode = 1; });
